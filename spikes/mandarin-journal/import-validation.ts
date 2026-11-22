import { randomUUID } from 'node:crypto';
import type { ReadingDocument } from './reading.ts';

export type Verdict = 'reading' | 'verification' | 'access' | 'unavailable' | 'uncertain';
export class ImportError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Sample = { title: string; paragraphs: string[] };
type Imported = ReadingDocument & { sourceUrl: string };
const reasons = {
  verification: 'The source returned a verification page.',
  access: 'The source returned an access or sign-in notice.',
  unavailable: 'The source says this page is unavailable.',
};

// Match standalone page labels and instructions. A quotation in a paragraph about
// verification, or a sign-in footer beneath an essay, is weak evidence on its own.
const notices = [
  {
    kind: 'verification',
    label: /^(?:环境异常|安全验证|人机验证|security (?:check|verification)|just a moment|checking your browser|verify (?:that )?you are human)$/i,
    instruction: /^(?:当前环境异常[，,。 ]*完成验证后即可继续访问|请完成(?:安全|人机)?验证(?:后继续访问)?|(?:please )?verify (?:that )?you are (?:a )?human(?: to continue)?|checking your browser before accessing .+)$/i,
  }, {
    kind: 'access',
    label: /^(?:access denied|forbidden|403(?: forbidden)?|需要登录|访问受限|sign in|log in)$/i,
    instruction: /^(?:请(?:先)?登录后(?:再)?(?:继续)?(?:访问|查看|阅读)(?:全文)?|(?:please |you must )?(?:log|sign) in to (?:continue|(?:read|view|access) (?:this|the) (?:article|page|content))|you (?:do not|don't) have permission to access .+)$/i,
  }, {
    kind: 'unavailable',
    label: /^(?:404(?: (?:page )?not found)?|page not found|service unavailable|internal server error|页面不存在|内容已删除|该内容已被发布者删除)$/i,
    instruction: /^(?:该(?:内容|文章|页面)(?:已被(?:发布者|作者)?删除|已下架|不存在)|(?:the |this )?(?:requested )?(?:page|article|content) (?:could not be found|has been (?:removed|deleted)|is no longer available|is (?:temporarily )?unavailable))$/i,
  },
] as const;
const hint = /阅览提示|阅读提示|安全提示|网页提示|返回首页|维护中|維護中|maintenance|access restricted|temporarily disabled|captcha|verification|verify|checking your browser|sign[ -]?in|log[ -]?in|access denied|not found|unavailable|enable javascript|subscribe to (?:read|continue)|验证码|验证|登录|登入|访问受限|页面不存在|内容已删除|載入失敗|頁面不存在|内容不可用/i;
function line(text: string) {
  return text.trim().replace(/[。.!！…]+$/u, '').trim();
}

export function inspectReading(doc: { title: string; sourceUrl?: string; paragraphs: { text: string }[] }): Verdict {
  const labels = doc.paragraphs.slice(0, 12).map(p => line(p.text));
  const title = line(doc.title);
  const short = doc.paragraphs.length <= 12 && labels.join('').length <= 1500;
  const chrome = /^(?:去验证|立即验证|返回|重试|继续|首页|刷新|登录|verify|continue|retry|go back|home|reload|sign in|log in)$/i;
  for (const { kind, label, instruction } of notices) {
    const heading = label.test(title) || label.test(labels[0] || '');
    const command = labels.some(text => instruction.test(text));
    const onlyNotice = short && labels.every(text => instruction.test(text) || label.test(text) || chrome.test(text));
    if (onlyNotice && (command || (heading && labels.every(text => label.test(text)))))
      return kind;
    if (heading || (short && command)) return 'uncertain';
  }
  // Send sparse, unlabeled pages and short notice-like extracts for a closer
  // look. A natural sentence or a verse with a real title can stand on its own.
  if (!short) return 'reading';
  const genericTitle = !title || title === labels[0] || (!!doc.sourceUrl && title === new URL(doc.sourceUrl).hostname);
  if (labels.join('').length <= 900 && (hint.test([title, ...labels].join(' ')) ||
      (genericTitle && labels.length <= 6 && doc.paragraphs.every(p => p.text.length < 55 && !/[。！？.!?]/u.test(p.text)))))
    return 'uncertain';
  return 'reading';
}

export function rejectionMessage(verdict: Verdict) {
  if (verdict === 'reading' || verdict === 'uncertain') return undefined;
  return reasons[verdict] + ' No reading was imported.';
}

export function legacyImportWarning(doc: ReadingDocument) {
  if (!doc.sourceUrl) return undefined;
  const verdict = inspectReading(doc);
  return verdict === 'uncertain' || verdict === 'reading' ? undefined : reasons[verdict];
}

export class ImportPreview extends ImportError {
  preview: { token: string; title: string; excerpt: string };
  constructor(document: Imported, token: string, message: string) {
    super(422, message);
    const text = document.paragraphs.map(p => p.text).join('\n');
    this.preview = { token, title: document.title, excerpt: text.length > 720 ? text.slice(0, 720) + '…' : text };
  }
}

export function createImportReviewer(
  download: (url: URL) => Promise<Imported>,
  judge?: (sample: Sample) => Promise<Verdict>,
) {
  // Only the single learner's latest review is outstanding. Confirmation saves
  // exactly what was previewed, even when the source changes between clicks.
  let pending: { url: string; token: string; document: Imported } | undefined;
  return async (url: URL, acceptPreview?: string) => {
    if (acceptPreview) {
      if (!pending || pending.token !== acceptPreview || pending.url !== url.href)
        throw new ImportError(422, 'That preview expired. Import the URL again to review its current text.');
      return pending.document;
    }
    const doc = await download(url);
    const initial = inspectReading(doc);
    const rejection = rejectionMessage(initial);
    if (rejection) throw new ImportError(422, rejection);
    if (initial === 'reading') return doc;

    let verdict: Verdict = 'uncertain';
    if (judge) {
      try {
        verdict = await judge({ title: doc.title, paragraphs: doc.paragraphs.map(p => p.text) });
      } catch {
        // An unavailable judge leaves the same learner review as the offline demo.
      }
    }
    if (verdict === 'reading') return doc;
    const message = verdict === 'uncertain' ? 'Is this the text you wanted to read?' : {
      verification: 'This looks like a verification page. Is this the text you wanted?',
      access: 'This looks like an access or sign-in notice. Is this the text you wanted?',
      unavailable: 'This looks like a notice that the page is unavailable. Is this the text you wanted?',
    }[verdict];
    pending = { url: url.href, token: randomUUID(), document: doc };
    throw new ImportPreview(doc, pending.token, message);
  };
}

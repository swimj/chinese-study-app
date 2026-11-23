type ReadingContent = {
  id: string;
  title: string;
  kind: string;
  paragraphs: { id: string; text: string; kind?: 'heading' }[];
};

export type WebReading = ReadingContent & { sourceUrl: string; importMethod?: 'paste' };
type ImportedReading = WebReading | (ReadingContent & { sourceUrl?: never; importMethod: 'pdf' });
export type ReadingDocument = ImportedReading | (ReadingContent & { sourceUrl?: never; importMethod?: never });

export const readingDocuments: ReadingDocument[] = [
  {
    id: 'riverside-kiosk',
    title: '河边的报刊亭',
    kind: 'Story',
    paragraphs: [
      {
        id: 'opening',
        text: '河边那座旧报刊亭关了三年。青绿色的铁皮被雨冲得发白，玻璃上还贴着一张早已过期的订报广告。每次路过，我总觉得亭子在等什么人。有一天早上，我听见里面传来敲敲打打的声音。窗子开着，窗台上搁着半杯茶。',
      },
      {
        id: 'key',
        text: '我凑过去一看，是住在对面楼里的周阿姨。她踩着一把折叠椅，正往墙上钉木板。见我探头，她便把锤子递给我：“来得正好，帮我扶一下。”我问她是不是又要卖报了。她说：“哪儿还有那么多人买报？这回卖不卖东西，我自己也没想好。”',
      },
      {
        id: 'umbrellas',
        text: '第二天下雨，亭子外多了一个塑料桶，里面插着六七把长短不一的伞。桶上贴了张纸：“没带伞就拿一把。有空了再还。”我记得周阿姨以前总嫌楼道里没人收拾，把一群邻居叫出来认领各自的旧伞。这回她干脆把没人认领的拿来用了。',
      },
      {
        id: 'clock',
        text: '过了几天，一个老爷爷拎着一只停了的挂钟来问能不能修。周阿姨说她只会缝衣服，不懂钟。他有些失望，正要走，买菜回来的老何却把菜篮子一放，借了把螺丝刀，当场拆开了钟。他修钟的时候，大家都安静下来，仿佛怕说话的声音盖过钟重新走起来的那一声。',
      },
      {
        id: 'sign',
        text: '从那以后，亭子里渐渐有了剪刀、针线和一盒大小不一的螺丝。周阿姨把原来的订报广告揭下来，在玻璃上贴了一张新纸：“有东西要修，过来看看。会修东西，也过来看看。”我常常在下班路上停一停，有时帮人穿个针，有时只是站着听他们聊天。',
      },
      {
        id: 'envelope',
        text: '入秋以后，我妈来住了几天。我领她到河边散步，顺便给她看这座亭子。她盯着窗台看了一会儿，从包里摸出一个信封，说那是给我缝裤脚剩下的几颗扣子，我大概用不着，不如留在这里。她把信封交给周阿姨，走出几步又折回去，在上面添了一句：“深蓝，乍一看像黑的。”',
      },
      {
        id: 'rain',
        text: '那天下午又下起雨。我妈没带伞，伸手从桶里抽了一把，撑开才发现有一根伞骨歪了。她正要换，想了想又把伞收起来，递给正在擦玻璃的老何：“这把还能修吗？”老何接过来，腾出窗台上一小块地方，说：“你等得及的话，咱们现在就看看。”',
      },
      {
        id: 'return',
        text: '我们在亭子里待到天快黑。出来时雨已经停了，那把伞还是借回了家。第二天我妈要赶早班车，临出门把伞靠在鞋柜边，托我下班带过去。傍晚我去还伞，看见窗边摆着一瓶新摘的桂花。周阿姨已经回家做饭了，窗子没关。我把伞插回桶里，站在窗前闻了一会儿。',
      },
    ],
  },
  {
    id: 'after-the-show',
    title: '散场以后',
    kind: 'Short essay',
    paragraphs: [
      {
        id: 'opening',
        text: '演唱会散场了，门口却没人急着走。有人轻轻哼了一句，旁边的人就接上了。',
      },
      {
        id: 'street',
        text: '我本来只想出去透透气，听着听着，也跟着唱了起来。刚才在里面，隔着几排都看不清对方；现在走到街上，倒像是一群认识了很久的朋友。',
      },
    ],
  },
];

export type Annotation = {
  id: string;
  documentId: string;
  paragraphId: string;
  quote: string;
  text: string;
};

export type ReadingState = {
  documentId: string;
  positions: Record<string, string>;
  imports: ImportedReading[];
  annotations: Annotation[];
};

export function initialReading(): ReadingState {
  return { documentId: readingDocuments[0].id, positions: {}, annotations: [], imports: [] };
}

export function documentsFor(reading: ReadingState) {
  return [...readingDocuments, ...reading.imports];
}

export class ReadingConflict extends Error {}

export function resolveReadingReference(referenceId: string, state: ReadingState) {
  const [documentId, paragraphId, annotationId, ...rest] = referenceId.split('/');
  const document = documentsFor(state).find((entry) => entry.id === documentId);
  if (!document || rest.length) throw new ReadingConflict('This reading is unavailable.');

  const paragraph =
    paragraphId === undefined ? undefined : document.paragraphs.find((entry) => entry.id === paragraphId);
  if (paragraphId !== undefined && !paragraph) throw new ReadingConflict('This passage is unavailable.');

  const annotation =
    annotationId === undefined
      ? undefined
      : state.annotations.find(
          (entry) => entry.documentId === documentId && entry.paragraphId === paragraphId && entry.id === annotationId,
        );
  if (annotationId !== undefined && !annotation) throw new ReadingConflict('This reading note is unavailable.');
  return { document, paragraph, annotation };
}

export function applyReadingPosition(state: ReadingState, documentId: string, paragraphId: string) {
  const { document, paragraph } = resolveReadingReference(documentId + '/' + paragraphId, state);
  if (!paragraph || document.id !== documentId || paragraph.id !== paragraphId) {
    throw new ReadingConflict('This passage is unavailable.');
  }
  state.documentId = document.id;
  state.positions[document.id] = paragraph.id;
}

export function addAnnotation(
  state: ReadingState,
  id: string,
  documentId: string,
  paragraphId: string,
  quote: string,
  text: string,
) {
  const { document, paragraph } = resolveReadingReference(documentId + '/' + paragraphId, state);
  if (!paragraph || document.id !== documentId || paragraph.id !== paragraphId) {
    throw new ReadingConflict('This passage is unavailable.');
  }
  if (quote && !paragraph.text.includes(quote)) throw new ReadingConflict('The selected text is unavailable.');
  state.annotations.push({ id, documentId, paragraphId, quote, text });
}

// Whole-article discussions use the learner’s saved place, including when it is near the end of a long work.
function discussionSource(document: ReadingDocument, position?: string) {
  const paragraphs = document.paragraphs.map(p => p.text);
  const body = paragraphs.join('\n');
  const budget = 6000;
  if (body.length <= budget) return document.title + '\n' + body;
  const index = Math.max(0, document.paragraphs.findIndex(p => p.id === position));
  const offset = paragraphs.slice(0, index).reduce((total, text) => total + text.length + 1, 0);
  const start = Math.max(0, Math.min(offset - 1500, body.length - budget));
  const end = start + budget;
  const excerpt = body.slice(start, end).replace(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/g, '');
  return document.title + '\n' + (start ? '…' : '') + excerpt + (end < body.length ? '…' : '');
}

export function readingSource(state: ReadingState, referenceId: string) {
  const { document, paragraph, annotation } = resolveReadingReference(referenceId, state);
  if (!paragraph) return discussionSource(document, state.positions[document.id]);
  const source = [document.title, paragraph.text];
  if (annotation?.quote) source.push('Selected text: ' + annotation.quote);
  if (annotation) source.push('Learner’s note: ' + annotation.text);
  return source.join('\n');
}

export function readingLabel(state: ReadingState, referenceId: string) {
  return resolveReadingReference(referenceId, state).document.title;
}

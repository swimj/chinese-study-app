// Teaching beats the learner advances one at a time. Earlier beats stay visible.

function node(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

/** One beat as a list item. */
export function renderBeat(beat) {
  const item = node('li', undefined, 'beat');
  for (const part of beat.parts) {
    if (part.kind === 'chinese') {
      const sentence = node('div', undefined, 'beat-sentence');
      const text = node('p', part.text, 'beat-chinese');
      text.lang = 'zh-Hans';
      sentence.append(text);
      if (part.pinyin) {
        const pinyin = node('p', part.pinyin, 'beat-pinyin');
        pinyin.lang = 'zh-Latn-pinyin';
        sentence.append(pinyin);
      }
      item.append(sentence);
    } else item.append(node('p', part.text, 'beat-' + part.kind));
  }
  return item;
}

/**
 * A teaching sequence with its Continue control. `shown` beats are visible at
 * first; Continue reveals the next and, after the last, calls onDone and
 * removes itself. With `done`, every beat is shown and there is no control.
 */
export function createTeaching(beats, { shown = 1, done = false, onAdvance = () => {}, onDone = () => {} } = {}) {
  const element = node('section', undefined, 'teaching');
  element.setAttribute('aria-label', 'Introduction');
  const list = node('ol', undefined, 'beats');
  list.setAttribute('aria-live', 'polite');
  let count = done ? beats.length : Math.min(Math.max(shown, 1), beats.length);
  for (const beat of beats.slice(0, count)) list.append(renderBeat(beat));
  list.lastElementChild?.classList.add('current');
  const progress = node('p', undefined, 'small card-type');
  const updateProgress = () => { progress.textContent = 'Introduction · ' + count + ' of ' + beats.length; };
  updateProgress();
  element.append(progress, list);
  if (done) return { element, control: null };
  const control = node('button', 'Continue', 'primary teaching-next');
  control.type = 'button';
  control.setAttribute('aria-keyshortcuts', 'Space');
  control.onclick = () => {
    if (count < beats.length) {
      list.lastElementChild?.classList.remove('current');
      const item = renderBeat(beats[count++]);
      item.classList.add('current');
      list.append(item);
      updateProgress();
      onAdvance(count);
      control.scrollIntoView({ block: 'nearest' });
      return;
    }
    list.lastElementChild?.classList.remove('current');
    control.remove();
    onDone();
  };
  element.append(control);
  return { element, control };
}

// Contextual examples for the two built-in readings. Each gloss belongs to this occurrence.
const passages = {
  'riverside-kiosk/opening': [
    ['报刊亭', 'bàokāntíng', 'A newsstand. The old newsstand by the river has been closed for three years.'],
    ['敲敲打打', 'qiāoqiāo dǎdǎ', 'Repeated tapping and hammering, heard from inside the kiosk.'],
    ['搁', 'gē', 'To set or leave something somewhere. Half a cup of tea sits on the sill.'],
  ],
  'after-the-show/opening': [
    ['散场', 'sànchǎng', 'For a show to end and the audience to disperse. Here, people linger afterward.'],
  ],
  'after-the-show/street': [
    ['透透气', 'tòu tou qì', 'To get a little fresh air. Repeating 透 gives the outing a brief, casual feel.'],
    ['听着听着', 'tīngzhe tīngzhe', 'As I kept listening… The repeated action sets up what happened next: I started singing along.'],
  ],
};

const characters = {
  报: ['bào', 'Newspaper, as in 报纸.'], 刊: ['kān', 'Publication or periodical, as in 刊物.'],
  亭: ['tíng', 'A booth or small pavilion.'], 敲: ['qiāo', 'To knock or tap.'],
  打: ['dǎ', 'To strike or hit.'], 散: ['sàn', 'To disperse.'], 场: ['chǎng', 'A gathering or performance.'],
  透: ['tòu', 'To let air through.'], 气: ['qì', 'Air or breath.'],
  听: ['tīng', 'To listen.'], 着: ['zhe', 'Marks an action as ongoing here.'],
};

export function passageLookups(ownerId, blockId, text) {
  return (passages[ownerId + '/' + blockId] || []).flatMap(([quote, pinyin, gloss]) => {
    const startOffset = text.indexOf(quote);
    if (startOffset < 0) return [];
    return [{
      anchor: { surface: 'read', ownerId, startId: blockId, endId: blockId, startOffset, endOffset: startOffset + quote.length, quote },
      pinyin, gloss,
    }];
  });
}

export function characterLookup(term, offset) {
  const quote = String.fromCodePoint(term.anchor.quote.codePointAt(offset));
  const detail = characters[quote];
  if (term.anchor.quote === quote || !detail) return;
  const startOffset = term.anchor.startOffset + offset;
  return {
    anchor: { ...term.anchor, startOffset, endOffset: startOffset + quote.length, quote },
    pinyin: detail[0], gloss: detail[1],
  };
}

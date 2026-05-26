PRAGMA foreign_keys = ON;

BEGIN;

-- One-time seed based on tmp/production-mistake-candidates.jsonl.
-- The selected clusters prioritize repeated production confusions plus high-value
-- Mandarin distinctions where English glosses collapse different usage patterns.

INSERT OR IGNORE INTO words (
  id,
  hanzi,
  traditional,
  pinyin,
  meaning,
  meanings_json,
  personal_notes,
  examples_json,
  status,
  priority,
  created_at
) VALUES
  ('cw:靠近:kào_jìn', '靠近', '靠近', 'kào jìn', 'to be close to; to approach; to draw near', '["to be close to","to approach; to draw near"]', '', '[]', 'review', 120556, '2026-04-11T10:56:13.185Z'),
  ('cw:临近:lín_jìn', '临近', '臨近', 'lín jìn', 'to approach; to draw near; to be close to (in space or time)', '["to approach; to draw near; to be close to (in space or time)"]', '', '[]', 'review', 110225, '2026-04-11T10:56:13.185Z'),
  ('cw:寻觅:xún_mì', '寻觅', '尋覓', 'xún mì', 'to look for', '["to look for"]', '', '[]', 'review', 110062, '2026-04-11T10:56:13.185Z'),
  ('cw:寻找:xún_zhǎo', '寻找', '尋找', 'xún zhǎo', 'to seek; to look for', '["to seek; to look for"]', '', '[]', 'review', 121208, '2026-04-11T10:56:13.185Z'),
  ('cw:寻求:xún_qiú', '寻求', '尋求', 'xún qiú', 'to seek; to look for', '["to seek; to look for"]', '', '[]', 'review', 118785, '2026-04-11T10:56:13.185Z'),
  ('cw:严峻:yán_jùn', '严峻', '嚴峻', 'yán jùn', 'grim; severe; rigorous', '["grim","severe","rigorous"]', '', '[]', 'review', 110505, '2026-04-11T10:56:13.185Z'),
  ('cw:庄重:zhuāng_zhòng', '庄重', '莊重', 'zhuāng zhòng', 'grave; solemn; dignified', '["grave","solemn","dignified"]', '', '[]', 'review', 107751, '2026-04-11T10:56:13.185Z'),
  ('cw:郑重:zhèng_zhòng', '郑重', '鄭重', 'zhèng zhòng', 'serious; solemn; earnest; conscientious', '["serious","solemn","earnest","conscientious"]', '', '[]', 'review', 110155, '2026-04-11T10:56:13.185Z'),
  ('cw:坚定:jiān_dìng', '坚定', '堅定', 'jiān dìng', 'firm; steady; staunch; resolute', '["firm","steady","staunch","resolute"]', '', '[]', 'review', 116623, '2026-04-11T10:56:13.185Z'),
  ('cw:坚固:jiān_gù', '坚固', '堅固', 'jiān gù', 'firm; firmly; hard; stable', '["firm","firmly","hard","stable"]', '', '[]', 'review', 112049, '2026-04-11T10:56:13.185Z'),
  ('cw:固执:gù_zhí', '固执', '固執', 'gù zhí', 'obstinate; stubborn; to fixate on; to cling to', '["obstinate","stubborn","to fixate on","to cling to"]', '', '[]', 'review', 116129, '2026-04-11T10:56:13.185Z'),
  ('cw:处分:chǔ_fèn', '处分', '處分', 'chǔ fèn', 'to discipline sb; to punish; disciplinary action; to deal with (a matter); CL:個|个[ge4]', '["to discipline sb","to punish","disciplinary action","to deal with (a matter)","CL:個|个[ge4]"]', '', '[]', 'review', 104204, '2026-04-11T10:56:13.185Z'),
  ('cw:处置:chǔ_zhì', '处置', '處置', 'chǔ zhì', 'to handle; to take care of; to punish', '["to handle","to take care of","to punish"]', '', '[]', 'review', 116243, '2026-04-11T10:56:13.185Z'),
  ('cw:惩罚:chéng_fá', '惩罚', '懲罰', 'chéng fá', 'penalty; punishment; to punish', '["penalty","punishment","to punish"]', '', '[]', 'review', 120308, '2026-04-11T10:56:13.185Z'),
  ('cw:不妨:bù_fáng', '不妨', '不妨', 'bù fáng', 'there is no harm in; might as well', '["there is no harm in; might as well"]', '', '[]', 'review', 112838, '2026-04-11T10:56:13.185Z'),
  ('cw:无妨:wú_fáng', '无妨', '無妨', 'wú fáng', 'no harm (in doing it); One might as well.; It won''t hurt.; no matter; it''s no bother', '["no harm (in doing it)","One might as well.","It won''t hurt.","no matter","it''s no bother"]', '', '[]', 'review', 108939, '2026-04-11T10:56:13.185Z'),
  ('cw:不由得:bù_yóu_de', '不由得', '不由得', 'bù yóu de', 'can''t help; cannot but', '["can''t help","cannot but"]', '', '[]', 'review', 94676, '2026-04-11T10:56:13.185Z'),
  ('cw:不禁:bù_jīn', '不禁', '不禁', 'bù jīn', 'can''t help (doing sth); can''t refrain from', '["can''t help (doing sth)","can''t refrain from"]', '', '[]', 'review', 110578, '2026-04-11T10:56:13.185Z'),
  ('cw:顾虑:gù_lǜ', '顾虑', '顧慮', 'gù lǜ', 'misgivings; apprehensions; to worry about; to be concerned about', '["misgivings; apprehensions","to worry about; to be concerned about"]', '', '[]', 'review', 112333, '2026-04-11T10:56:13.185Z'),
  ('cw:担忧:dān_yōu', '担忧', '擔憂', 'dān yōu', 'to worry; to be concerned', '["to worry","to be concerned"]', '', '[]', 'review', 115287, '2026-04-11T10:56:13.185Z'),
  ('cw:忧虑:yōu_lǜ', '忧虑', '憂慮', 'yōu lǜ', 'to worry; anxiety (about)', '["to worry","anxiety (about)"]', '', '[]', 'review', 110481, '2026-04-11T10:56:13.185Z'),
  ('cw:支援:zhī_yuán', '支援', '支援', 'zhī yuán', 'to provide assistance; to support; to back', '["to provide assistance","to support","to back"]', '', '[]', 'review', 118908, '2026-04-11T10:56:13.185Z'),
  ('cw:补助:bǔ_zhù', '补助', '補助', 'bǔ zhù', 'to subsidize; subsidy; allowance', '["to subsidize","subsidy","allowance"]', '', '[]', 'review', 108038, '2026-04-11T10:56:13.185Z'),
  ('cw:陈述:chén_shù', '陈述', '陳述', 'chén shù', 'to state; to declare', '["to state; to declare"]', '', '[]', 'review', 117569, '2026-04-11T10:56:13.185Z'),
  ('cw:声明:shēng_míng', '声明', '聲明', 'shēng míng', 'to state; to declare; statement; declaration; CL:項|项[xiang4],份[fen4]', '["to state","to declare","statement","declaration","CL:項|项[xiang4],份[fen4]"]', '', '[]', 'review', 118825, '2026-04-11T10:56:13.185Z');

UPDATE words
SET status = 'review'
WHERE id IN (
  'cw:靠近:kào_jìn', 'cw:临近:lín_jìn', 'cw:寻觅:xún_mì', 'cw:寻找:xún_zhǎo', 'cw:寻求:xún_qiú',
  'cw:严峻:yán_jùn', 'cw:庄重:zhuāng_zhòng', 'cw:郑重:zhèng_zhòng', 'cw:坚定:jiān_dìng', 'cw:坚固:jiān_gù',
  'cw:固执:gù_zhí', 'cw:处分:chǔ_fèn', 'cw:处置:chǔ_zhì', 'cw:惩罚:chéng_fá', 'cw:不妨:bù_fáng',
  'cw:无妨:wú_fáng', 'cw:不由得:bù_yóu_de', 'cw:不禁:bù_jīn', 'cw:顾虑:gù_lǜ', 'cw:担忧:dān_yōu',
  'cw:忧虑:yōu_lǜ', 'cw:支援:zhī_yuán', 'cw:补助:bǔ_zhù', 'cw:陈述:chén_shù', 'cw:声明:shēng_míng'
);

INSERT OR IGNORE INTO word_meanings (
  id,
  word_id,
  position,
  text,
  show_on_production_prompt,
  created_at,
  updated_at
) VALUES
  ('seed-meaning-kaojin', 'cw:靠近:kào_jìn', 1, 'to be close to; to approach; to draw near', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-linjin', 'cw:临近:lín_jìn', 1, 'to approach; to draw near; to be close to (in space or time)', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-xunmi', 'cw:寻觅:xún_mì', 1, 'to look for', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-xunzhao', 'cw:寻找:xún_zhǎo', 1, 'to seek; to look for', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-xunqiu', 'cw:寻求:xún_qiú', 1, 'to seek; to look for', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-yanjun', 'cw:严峻:yán_jùn', 1, 'grim; severe; rigorous', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-zhuangzhong', 'cw:庄重:zhuāng_zhòng', 1, 'grave; solemn; dignified', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-zhengzhong', 'cw:郑重:zhèng_zhòng', 1, 'serious; solemn; earnest; conscientious', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-jianding', 'cw:坚定:jiān_dìng', 1, 'firm; steady; staunch; resolute', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-jiangu', 'cw:坚固:jiān_gù', 1, 'firm; firmly; hard; stable', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-guzhi', 'cw:固执:gù_zhí', 1, 'obstinate; stubborn; to fixate on; to cling to', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-chufen', 'cw:处分:chǔ_fèn', 1, 'to discipline sb; to punish; disciplinary action; to deal with (a matter)', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-chuzhi', 'cw:处置:chǔ_zhì', 1, 'to handle; to take care of; to punish', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-chengfa', 'cw:惩罚:chéng_fá', 1, 'penalty; punishment; to punish', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-bufang', 'cw:不妨:bù_fáng', 1, 'there is no harm in; might as well', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-wufang', 'cw:无妨:wú_fáng', 1, 'no harm; it will not hurt; no bother', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-buyoude', 'cw:不由得:bù_yóu_de', 1, 'can not help; cannot but', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-bujin', 'cw:不禁:bù_jīn', 1, 'can not help doing something; can not refrain from', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-gulv', 'cw:顾虑:gù_lǜ', 1, 'misgivings; apprehensions; to worry about', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-danyou', 'cw:担忧:dān_yōu', 1, 'to worry; to be concerned', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-youlv', 'cw:忧虑:yōu_lǜ', 1, 'to worry; anxiety about something', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-zhiyuan', 'cw:支援:zhī_yuán', 1, 'to provide assistance; to support; to back', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-buzhu', 'cw:补助:bǔ_zhù', 1, 'to subsidize; subsidy; allowance', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-chenshu', 'cw:陈述:chén_shù', 1, 'to state; to set out facts', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z'),
  ('seed-meaning-shengming', 'cw:声明:shēng_míng', 1, 'to declare; statement; declaration', 1, '2026-05-27T00:00:00.000Z', '2026-05-27T00:00:00.000Z');

INSERT INTO word_study_admission_state (
  word_id,
  study_phase,
  earliest_next_study_at
) VALUES
  ('cw:靠近:kào_jìn', 'review', NULL),
  ('cw:临近:lín_jìn', 'review', NULL),
  ('cw:寻觅:xún_mì', 'review', NULL),
  ('cw:寻找:xún_zhǎo', 'review', NULL),
  ('cw:寻求:xún_qiú', 'review', NULL),
  ('cw:严峻:yán_jùn', 'review', NULL),
  ('cw:庄重:zhuāng_zhòng', 'review', NULL),
  ('cw:郑重:zhèng_zhòng', 'review', NULL),
  ('cw:坚定:jiān_dìng', 'review', NULL),
  ('cw:坚固:jiān_gù', 'review', NULL),
  ('cw:固执:gù_zhí', 'review', NULL),
  ('cw:处分:chǔ_fèn', 'review', NULL),
  ('cw:处置:chǔ_zhì', 'review', NULL),
  ('cw:惩罚:chéng_fá', 'review', NULL),
  ('cw:不妨:bù_fáng', 'review', NULL),
  ('cw:无妨:wú_fáng', 'review', NULL),
  ('cw:不由得:bù_yóu_de', 'review', NULL),
  ('cw:不禁:bù_jīn', 'review', NULL),
  ('cw:顾虑:gù_lǜ', 'review', NULL),
  ('cw:担忧:dān_yōu', 'review', NULL),
  ('cw:忧虑:yōu_lǜ', 'review', NULL),
  ('cw:支援:zhī_yuán', 'review', NULL),
  ('cw:补助:bǔ_zhù', 'review', NULL),
  ('cw:陈述:chén_shù', 'review', NULL),
  ('cw:声明:shēng_míng', 'review', NULL)
ON CONFLICT(word_id) DO UPDATE SET
  study_phase = excluded.study_phase,
  earliest_next_study_at = excluded.earliest_next_study_at;

INSERT INTO word_skill_state (
  word_id,
  skill_id,
  enabled,
  interval_hours,
  last_studied_at,
  next_due_at,
  ease_factor
) VALUES
  ('cw:靠近:kào_jìn', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:临近:lín_jìn', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:寻觅:xún_mì', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:寻找:xún_zhǎo', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:寻求:xún_qiú', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:严峻:yán_jùn', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:庄重:zhuāng_zhòng', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:郑重:zhèng_zhòng', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:坚定:jiān_dìng', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:坚固:jiān_gù', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:固执:gù_zhí', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:处分:chǔ_fèn', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:处置:chǔ_zhì', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:惩罚:chéng_fá', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:不妨:bù_fáng', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:无妨:wú_fáng', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:不由得:bù_yóu_de', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:不禁:bù_jīn', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:顾虑:gù_lǜ', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:担忧:dān_yōu', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:忧虑:yōu_lǜ', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:支援:zhī_yuán', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:补助:bǔ_zhù', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:陈述:chén_shù', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5),
  ('cw:声明:shēng_míng', 'contextual_selection', 1, 24, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 2.5)
ON CONFLICT(word_id, skill_id) DO UPDATE SET
  enabled = excluded.enabled,
  interval_hours = excluded.interval_hours,
  last_studied_at = excluded.last_studied_at,
  next_due_at = excluded.next_due_at,
  ease_factor = excluded.ease_factor;

INSERT INTO word_skill_relevance (
  word_id,
  skill_id,
  relevance_state,
  updated_at,
  source_event_id
) VALUES
  ('cw:靠近:kào_jìn', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:临近:lín_jìn', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:寻觅:xún_mì', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:寻找:xún_zhǎo', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:寻求:xún_qiú', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:严峻:yán_jùn', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:庄重:zhuāng_zhòng', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:郑重:zhèng_zhòng', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:坚定:jiān_dìng', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:坚固:jiān_gù', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:固执:gù_zhí', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:处分:chǔ_fèn', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:处置:chǔ_zhì', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:惩罚:chéng_fá', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:不妨:bù_fáng', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:无妨:wú_fáng', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:不由得:bù_yóu_de', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:不禁:bù_jīn', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:顾虑:gù_lǜ', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:担忧:dān_yōu', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:忧虑:yōu_lǜ', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:支援:zhī_yuán', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:补助:bǔ_zhù', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:陈述:chén_shù', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL),
  ('cw:声明:shēng_míng', 'contextual_selection', 'normal', '2026-05-27T00:00:00.000Z', NULL)
ON CONFLICT(word_id, skill_id) DO UPDATE SET
  relevance_state = excluded.relevance_state,
  updated_at = excluded.updated_at,
  source_event_id = excluded.source_event_id;

INSERT OR IGNORE INTO contrast_clusters (
  id,
  title,
  note
) VALUES
  ('seed-contrast-kaojin-linjin', '靠近 / 临近', 'Repeated production confusion. 靠近 is physical nearness or moving close; 临近 is an approaching time, deadline, season, or abstract point.'),
  ('seed-contrast-xun-search', '寻找 / 寻觅 / 寻求', 'Repeated search-verb confusion. 寻找 is plain looking for; 寻觅 is literary or patient searching; 寻求 targets help, solutions, opportunities, or methods.'),
  ('seed-contrast-solemn-severe', '严峻 / 庄重 / 郑重', 'Severity versus solemnity. 严峻 modifies situations and tests; 庄重 describes dignified style or bearing; 郑重 describes earnest statements and commitments.'),
  ('seed-contrast-firm-stubborn', '坚定 / 坚固 / 固执', 'Firmness split by domain and evaluation. 坚定 is mental resolve; 坚固 is physical solidity; 固执 is stubbornly refusing to change.'),
  ('seed-contrast-punish-handle', '处分 / 处置 / 惩罚', 'Handling and punishment terms. 处分 is formal disciplinary action; 处置 is handling or disposing of a matter; 惩罚 is punishment itself.'),
  ('seed-contrast-bufang-wufang', '不妨 / 无妨', 'Both say no harm, but 不妨 suggests a course of action; 无妨 reassures that something is not a problem.'),
  ('seed-contrast-involuntary', '不由得 / 不禁', 'Both can be can not help. 不禁 is emotional self-restraint failing; 不由得 emphasizes being led by circumstances or involuntary reaction.'),
  ('seed-contrast-worry', '顾虑 / 担忧 / 忧虑', 'Worry terms. 顾虑 is a reservation or misgiving that may block action; 担忧 is concern about risk; 忧虑 is heavier anxiety.'),
  ('seed-contrast-support-subsidy', '支援 / 补助', 'Support versus subsidy. 支援 is active backing with people, resources, or effort; 补助 is financial/material assistance or an allowance.'),
  ('seed-contrast-state-declare', '陈述 / 声明', 'Statement verbs. 陈述 sets out facts or a narrative; 声明 publicly declares a stance, position, or formal notice.');

INSERT OR IGNORE INTO contrast_cluster_members (
  cluster_id,
  word_id,
  nuance_note,
  display_order
) VALUES
  ('seed-contrast-kaojin-linjin', 'cw:靠近:kào_jìn', 'Physical closeness or moving toward someone/something.', 1),
  ('seed-contrast-kaojin-linjin', 'cw:临近:lín_jìn', 'A time, deadline, season, or moment is approaching.', 2),
  ('seed-contrast-xun-search', 'cw:寻找:xún_zhǎo', 'Neutral everyday looking for a person, object, or answer.', 1),
  ('seed-contrast-xun-search', 'cw:寻觅:xún_mì', 'Literary, patient, or emotionally colored searching.', 2),
  ('seed-contrast-xun-search', 'cw:寻求:xún_qiú', 'Seeking help, methods, solutions, cooperation, or opportunities.', 3),
  ('seed-contrast-solemn-severe', 'cw:严峻:yán_jùn', 'Severe or grave situations, challenges, tests, or conditions.', 1),
  ('seed-contrast-solemn-severe', 'cw:庄重:zhuāng_zhòng', 'Dignified appearance, style, ceremony, atmosphere, or bearing.', 2),
  ('seed-contrast-solemn-severe', 'cw:郑重:zhèng_zhòng', 'Earnest, solemn statements, promises, requests, or apologies.', 3),
  ('seed-contrast-firm-stubborn', 'cw:坚定:jiān_dìng', 'Steady resolve, belief, stance, or confidence.', 1),
  ('seed-contrast-firm-stubborn', 'cw:坚固:jiān_gù', 'Solid physical structure, foundation, wall, material, or relationship.', 2),
  ('seed-contrast-firm-stubborn', 'cw:固执:gù_zhí', 'Negative stubborn refusal to change views or behavior.', 3),
  ('seed-contrast-punish-handle', 'cw:处分:chǔ_fèn', 'Formal disciplinary penalty by a school, employer, or organization.', 1),
  ('seed-contrast-punish-handle', 'cw:处置:chǔ_zhì', 'Handle, deal with, dispose of, or settle a matter.', 2),
  ('seed-contrast-punish-handle', 'cw:惩罚:chéng_fá', 'Punish or impose a penalty for wrongdoing.', 3),
  ('seed-contrast-bufang-wufang', 'cw:不妨:bù_fáng', 'Used to propose that trying something would be fine.', 1),
  ('seed-contrast-bufang-wufang', 'cw:无妨:wú_fáng', 'Used to reassure that something does not matter or causes no harm.', 2),
  ('seed-contrast-involuntary', 'cw:不由得:bù_yóu_de', 'Involuntary reaction caused by circumstances or external pull.', 1),
  ('seed-contrast-involuntary', 'cw:不禁:bù_jīn', 'Can not restrain an inner emotional reaction.', 2),
  ('seed-contrast-worry', 'cw:顾虑:gù_lǜ', 'A reservation, misgiving, or concern that affects action.', 1),
  ('seed-contrast-worry', 'cw:担忧:dān_yōu', 'Concern or worry about a possible bad outcome.', 2),
  ('seed-contrast-worry', 'cw:忧虑:yōu_lǜ', 'Heavier anxiety or worried state of mind.', 3),
  ('seed-contrast-support-subsidy', 'cw:支援:zhī_yuán', 'Active support with people, resources, materials, or effort.', 1),
  ('seed-contrast-support-subsidy', 'cw:补助:bǔ_zhù', 'Financial or material subsidy, allowance, or aid.', 2),
  ('seed-contrast-state-declare', 'cw:陈述:chén_shù', 'State facts, events, reasons, or a narrative clearly.', 1),
  ('seed-contrast-state-declare', 'cw:声明:shēng_míng', 'Publicly declare a formal stance, position, or notice.', 2);

INSERT OR IGNORE INTO contrast_prompts (
  id,
  cluster_id,
  target_word_id,
  prompt_text,
  explanation
) VALUES
  ('seed-prompt-kaojin', 'seed-contrast-kaojin-linjin', 'cw:靠近:kào_jìn', '请不要____施工区域，那里还没有完全封闭。', 'The warning is about moving physically close to an area, so 靠近 fits.'),
  ('seed-prompt-linjin', 'seed-contrast-kaojin-linjin', 'cw:临近:lín_jìn', '春节____，火车票又开始紧张起来。', 'A holiday is approaching in time, so 临近 fits.'),
  ('seed-prompt-xunzhao', 'seed-contrast-xun-search', 'cw:寻找:xún_zhǎo', '警察正在____失踪孩子的线索。', 'This is a neutral search for clues, so 寻找 fits.'),
  ('seed-prompt-xunmi', 'seed-contrast-xun-search', 'cw:寻觅:xún_mì', '多年以后，他仍在____童年记忆里的那条小巷。', 'The sentence has a literary, emotionally colored search, so 寻觅 fits.'),
  ('seed-prompt-xunqiu', 'seed-contrast-xun-search', 'cw:寻求:xún_qiú', '公司正在____新的合作伙伴来开拓海外市场。', 'The object is cooperation or opportunity, so 寻求 fits.'),
  ('seed-prompt-yanjun', 'seed-contrast-solemn-severe', 'cw:严峻:yán_jùn', '这座城市正面临____的用水危机。', 'A crisis or challenge can be 严峻: severe and grave.'),
  ('seed-prompt-zhuangzhong', 'seed-contrast-solemn-severe', 'cw:庄重:zhuāng_zhòng', '参加追悼会时，他穿了一套____的黑色西装。', 'Dress and bearing for a solemn occasion can be 庄重.'),
  ('seed-prompt-zhengzhong', 'seed-contrast-solemn-severe', 'cw:郑重:zhèng_zhòng', '负责人向居民____承诺会公开调查结果。', 'A formal promise or commitment can be 郑重.'),
  ('seed-prompt-jianding', 'seed-contrast-firm-stubborn', 'cw:坚定:jiān_dìng', '面对质疑，她仍然保持____的信念。', 'Belief or resolve can be 坚定.'),
  ('seed-prompt-jiangu', 'seed-contrast-firm-stubborn', 'cw:坚固:jiān_gù', '这座桥的结构非常____，可以承受强风。', 'A bridge structure is physically solid, so 坚固 fits.'),
  ('seed-prompt-guzhi', 'seed-contrast-firm-stubborn', 'cw:固执:gù_zhí', '大家已经解释清楚了，他还是____地不肯改。', 'Refusing to change despite explanation is 固执.'),
  ('seed-prompt-chufen', 'seed-contrast-punish-handle', 'cw:处分:chǔ_fèn', '学校决定对作弊的学生给予记过____。', 'A formal disciplinary penalty is 处分.'),
  ('seed-prompt-chuzhi', 'seed-contrast-punish-handle', 'cw:处置:chǔ_zhì', '这些过期药品必须按照规定统一____。', 'Handling or disposing of items according to rules is 处置.'),
  ('seed-prompt-chengfa', 'seed-contrast-punish-handle', 'cw:惩罚:chéng_fá', '法律的目的不只是____犯罪者，也要保护受害人。', 'The act of punishing offenders is 惩罚.'),
  ('seed-prompt-bufang', 'seed-contrast-bufang-wufang', 'cw:不妨:bù_fáng', '如果你还不确定，____先试用一周再决定。', 'The sentence suggests a reasonable action to try, so 不妨 fits.'),
  ('seed-prompt-wufang', 'seed-contrast-bufang-wufang', 'cw:无妨:wú_fáng', '晚到十分钟也____，会议还没有正式开始。', 'This reassures that the delay does not matter, so 无妨 fits.'),
  ('seed-prompt-buyoude', 'seed-contrast-involuntary', 'cw:不由得:bù_yóu_de', '听见熟悉的旋律，他____想起了故乡。', 'The memory arises involuntarily because of the melody, so 不由得 fits.'),
  ('seed-prompt-bujin', 'seed-contrast-involuntary', 'cw:不禁:bù_jīn', '看到孩子笨拙地鞠躬，大家都____笑了起来。', 'The laughter is an unrestrained emotional reaction, so 不禁 fits.'),
  ('seed-prompt-gulv', 'seed-contrast-worry', 'cw:顾虑:gù_lǜ', '她迟迟不签合同，是因为对付款方式还有____。', 'A reservation blocking action is 顾虑.'),
  ('seed-prompt-danyou', 'seed-contrast-worry', 'cw:担忧:dān_yōu', '家人很____他的身体状况，劝他早点去医院。', 'Concern about someone health is 担忧.'),
  ('seed-prompt-youlv', 'seed-contrast-worry', 'cw:忧虑:yōu_lǜ', '连续几天睡不好，让她的脸上露出了深深的____。', 'A heavy anxious state is 忧虑.'),
  ('seed-prompt-zhiyuan', 'seed-contrast-support-subsidy', 'cw:支援:zhī_yuán', '灾区急需外地医疗队前来____救治工作。', 'Sending active help and resources is 支援.'),
  ('seed-prompt-buzhu', 'seed-contrast-support-subsidy', 'cw:补助:bǔ_zhù', '学校为经济困难的学生提供生活____。', 'Financial or material allowance is 补助.'),
  ('seed-prompt-chenshu', 'seed-contrast-state-declare', 'cw:陈述:chén_shù', '证人需要如实____当晚发生的经过。', 'A witness states facts and sequence of events, so 陈述 fits.'),
  ('seed-prompt-shengming', 'seed-contrast-state-declare', 'cw:声明:shēng_míng', '公司发表____，否认了网上流传的传闻。', 'A public formal notice or stance is a 声明.');

COMMIT;

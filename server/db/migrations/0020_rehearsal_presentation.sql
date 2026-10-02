-- Remove only the former normalizer's exact presentation boilerplate from
-- shared teaching content. Never rewrite instructions in served/session history,
-- custom wording, stimuli, answers, provenance, or publication disposition.
-- The offline runner makes this temporary immutability exception transactional.
DROP TRIGGER word_teaching_packages_immutable;

WITH RECURSIVE cleaned(package_id, package_json, next_index) AS (
  SELECT package_id, package_json, 0
  FROM word_teaching_packages
  WHERE CASE WHEN json_valid(package_json)
    THEN json_type(package_json, '$.rehearsals') = 'array' ELSE 0 END
  UNION ALL
  SELECT package_id,
    CASE WHEN json_extract(package_json, '$.rehearsals[' || next_index || '].instruction') =
      'Recall the expression you just met. Enter only that expression in Chinese characters, not the whole sentence.'
    THEN json_set(package_json, '$.rehearsals[' || next_index || '].instruction', '')
    ELSE package_json END,
    next_index + 1
  FROM cleaned
  WHERE next_index < json_array_length(package_json, '$.rehearsals')
)
UPDATE word_teaching_packages AS package
SET package_json = (
  SELECT cleaned.package_json FROM cleaned
  WHERE cleaned.package_id = package.package_id
    AND next_index = json_array_length(cleaned.package_json, '$.rehearsals')
)
WHERE EXISTS (
  SELECT 1 FROM cleaned
  WHERE cleaned.package_id = package.package_id
    AND next_index = json_array_length(cleaned.package_json, '$.rehearsals')
    AND cleaned.package_json != package.package_json
);

CREATE TRIGGER word_teaching_packages_immutable BEFORE UPDATE ON word_teaching_packages
BEGIN SELECT RAISE(ABORT, 'word teaching packages are immutable'); END;

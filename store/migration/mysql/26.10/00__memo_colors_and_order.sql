ALTER TABLE `memo` ADD COLUMN `color` VARCHAR(32) NOT NULL DEFAULT '';

CREATE TABLE `memo_order` (
  `memo_id` INT NOT NULL PRIMARY KEY,
  `creator_id` INT NOT NULL,
  `rank` BIGINT NOT NULL,
  CONSTRAINT `fk_memo_order_memo` FOREIGN KEY (`memo_id`) REFERENCES `memo`(`id`) ON DELETE CASCADE,
  INDEX `idx_memo_order_creator_rank` (`creator_id`, `rank`, `memo_id`)
);

CREATE TABLE `memo_order_revision` (
  `creator_id` INT NOT NULL PRIMARY KEY,
  `revision` BIGINT NOT NULL DEFAULT 0
);

INSERT INTO `memo_order` (`memo_id`, `creator_id`, `rank`)
SELECT m.`id`, m.`creator_id`,
  ROW_NUMBER() OVER (PARTITION BY m.`creator_id` ORDER BY m.`created_ts` DESC, m.`uid` DESC) * 1024
FROM `memo` m
WHERE NOT EXISTS (SELECT 1 FROM `memo_relation` r WHERE r.`memo_id` = m.`id` AND r.`type` = 'COMMENT');

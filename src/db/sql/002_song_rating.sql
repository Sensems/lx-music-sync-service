-- Subsonic setRating 要落在歌曲上。没有这一列时，客户端打完分再拉列表，星星会消失。
-- IF NOT EXISTS：上一轮如果加列成功、写入迁移记录失败，重跑不能卡在「列已存在」。
ALTER TABLE songs ADD COLUMN IF NOT EXISTS user_rating smallint;

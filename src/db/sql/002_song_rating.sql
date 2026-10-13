-- Subsonic setRating 要落在歌曲上。没有这一列时，客户端打完分再拉列表，星星会消失。
ALTER TABLE songs ADD COLUMN user_rating smallint;

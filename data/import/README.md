# Файлы для импорта

Положите сюда списки игр, и GitHub Actions добавит их в `data/games.json`.
Источник берётся из начала имени файла:

| Файл | Источник |
|---|---|
| `epic.txt` | Epic Games |
| `nintendo.txt` | Nintendo |
| `backloggd.csv` | Backloggd |
| `mygamelist.csv` | MyGameList |
| `psn.txt`, `xbox.txt`, `steam.txt` | соответствующие платформы |
| всё остальное | «Вручную» |

Форматы: `.txt` (по игре на строку), `.csv` (колонка `title`/`name`/`название`; по желанию `platform`, `hours`, `progress`, `status`; строки со статусом `completed`/`пройдено` пропускаются) и `.json`.

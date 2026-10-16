# ADR 0065: bookmarks panel redesign

Status: accepted (owner request, 2026-10-16)

Each bookmark is a card: its picture, its name and when it was saved (`b.at`), and three buttons: **Rename** (a box in place of the name; Enter or leaving keeps it, Escape does not; double-click the name or F2 on the card work too), **Update** (the bookmark now points at the view as it is, `BookmarkList.update`, with a fresh picture; the old picture stays when the browser cannot make one; the saved time changes) and **Delete**. A click on the card, or Enter or Space on it, goes there. The header is one row (title and count, Add, Close). The empty state says what to do. On a touch screen (and at 640 px or less) the buttons are 36 px and always shown; on a mouse they show on hover or focus.

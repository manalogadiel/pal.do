# Weekly class schedule import

Attach a PNG/JPEG/WebP screenshot, PDF, or DOCX in chat. Choose a folder, create one, or keep the attachment in chat as before. On its file card, select **Extract class schedule**, then request online extraction. Nothing is added by attaching or extracting.

For a PDF, preview pages using the page-number field and check **Include page**. The first page is selected initially; at most three pages are sent per extraction. Both scanned and ordinary PDFs are rendered locally through PDF.js. After finishing, reopen the same file card or choose another set of pages to process the rest. Exact matching calendar classes are skipped.

DOCX paragraphs and tables are converted locally by lazily loaded Mammoth into text with table-cell separators. This text is displayed safely as text. Embedded images are ignored; export an image-only document to PDF or attach a screenshot instead. TXT and Markdown keep their existing attachment behavior and are not class-schedule extraction sources.

Review every proposed title, weekday, time, room, and instructor. Unclear rows start unchecked. Correct the source uncertainties, acknowledge the corrected row, then include it. Add/remove rows as needed. The default range is today through 55 days later in the device timezone used by the existing calendar, falling back to Asia/Manila when unavailable. Edit both dates for your school term. Only future occurrences are included; overnight classes are unsupported. A range longer than a year must be split into separate imports to bound the batch size.

Use **Confirm and add selected classes** to save. Chat/voice “yes” does not confirm this review. Existing classes are matched by normalized title/start/end; overlapping new or existing classes require **Add despite overlaps**. Changing reviewed fields resets overlap approval. The latest calendar is checked again before a single persisted batch update. Other events, tasks, and transportation are untouched. Room/instructor are saved as ordinary calendar notes, editable with existing schedule controls.

Preparation limits: original attachment 25 MB, longest image side 2,560 pixels, prepared images 3 MB total, DOCX text 100,000 characters, endpoint request 4.5 MB. Oversized sources are rejected without truncating timetable content. Extraction has a 30-second deadline on both client and provider/quota work. Cancel prevents late results from reopening the review. Storage failures leave the review and current calendar intact.

The service is `POST /api/schedule-extract`, available through Vite development/preview middleware and a deployed Vercel function. It uses the existing server-only `GEMINI_API_KEY`, origin checks, and device quota. `vercel.json` grants the function 35 seconds so the app's 30-second deadline can return its recovery message; see [Vercel duration configuration](https://vercel.com/docs/functions/configuring-functions/duration). See [deployment setup](deploy-vercel.md). Without credentials or a network connection, the dialog provides manual entry. No API key is bundled in the app.

## Verification

Pure/server regressions:

```sh
node scripts/check-class-schedule.mjs
node scripts/check-schedule-source.mjs
node scripts/check-schedule-api.mjs
node scripts/check-schedule-review.mjs
```

With `playwright-core` installed or `PLAYWRIGHT_MODULE` set to its module path, run `node scripts/check-schedule-import-ui.mjs` against the running preview. It uses real generated image, text/scanned PDF, encrypted PDF, and DOCX fixtures, while stubbing only provider results. It checks corrections, source pages, review limits, responsive bounds, duplicates, overlaps, double clicks, persistence failure/reload, service errors and cancellation.

`node scripts/check-schedule-live.mjs` sends synthetic readable image, ordinary PDF, scanned PDF, and DOCX fixtures through the configured service, without saving events. It explicitly reports when missing credentials prevent real-provider validation; mock tests are not evidence of model extraction accuracy.

Scope: weekly school schedules; one service, one review, current IndexedDB files/calendar persistence. No general document editor, OCR engine, recurring-event framework, new file families, or automatic calendar insertion.

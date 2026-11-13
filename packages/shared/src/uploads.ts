/**
 * Attachments are uploaded as the raw request body (not multipart), so the
 * server can stream them straight to storage:
 *   POST /api/pages/:id/attachments  (or /api/cards/:id/attachments)
 *   Content-Type: the file's type · Content-Length: its size
 *   X-File-Name: the file name, percent-encoded (encodeURIComponent)
 */
export const UPLOAD_NAME_HEADER = 'X-File-Name'

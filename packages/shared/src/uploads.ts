/**
 * Attachments are uploaded as the raw request body (not multipart), so the
 * server can stream them straight to storage:
 *   POST /api/pages/:id/attachments  (or /api/cards/:id/attachments)
 *   Content-Type: the file's type · Content-Length: its size
 *   X-File-Name: the file name, percent-encoded (encodeURIComponent)
 */
export const UPLOAD_NAME_HEADER = 'X-File-Name'

/**
 * Characters that change the direction text is shown in, without showing themselves (U+202E and
 * its kind): `\u202Egnp.exe` shows as «exe.png». A file name has no use for them, and they can pass
 * an executable off as a picture.
 */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

/** A file name as it truly is: without the characters that would show it in another order. */
export const withoutBidiControls = (name: string) => name.replace(BIDI_CONTROLS, '')

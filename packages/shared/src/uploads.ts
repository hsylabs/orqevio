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

/** What a page plays where a file is linked: a video or a sound. */
export type MediaKind = 'video' | 'audio'

/**
 * The video and audio types browsers play, which the server sends as they are, for a page to play
 * them; any other file but a picture is sent as a download.
 */
const PLAYED: Record<string, MediaKind> = {
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/ogg': 'video',
  'video/quicktime': 'video',
  'audio/mpeg': 'audio',
  'audio/mp3': 'audio',
  'audio/mp4': 'audio',
  'audio/x-m4a': 'audio',
  'audio/aac': 'audio',
  'audio/ogg': 'audio',
  'audio/opus': 'audio',
  'audio/wav': 'audio',
  'audio/wave': 'audio',
  'audio/x-wav': 'audio',
  'audio/webm': 'audio',
  'audio/flac': 'audio',
  'audio/x-flac': 'audio',
}

/** Whether a file of this type is played, and as what. */
export const mediaKind = (mimeType: string): MediaKind | null => (Object.hasOwn(PLAYED, mimeType) ? PLAYED[mimeType]! : null)

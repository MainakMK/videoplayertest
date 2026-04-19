const multer = require('multer');
const path = require('path');

/**
 * Sanitize an upload filename so it can't escape the uploads directory.
 * Removes path traversal segments (../), drive letters, and null bytes.
 * Uses path.basename to strip any directory components, then collapses
 * any remaining whitespace/control characters to underscores.
 */
function sanitizeOriginalName(name) {
  // path.basename strips directory components on both POSIX and Windows
  let base = path.basename(String(name || 'video'));
  // Strip null bytes (poisoning attack on some FS APIs)
  base = base.replace(/\0/g, '');
  // Replace anything that isn't safe with an underscore
  base = base.replace(/[^a-zA-Z0-9._\- ]/g, '_');
  // Don't allow names that are entirely dots/spaces
  if (!base || /^[\.\s_]+$/.test(base)) base = 'video';
  // Cap length so the timestamp + name fits comfortably under common 255-char limits
  if (base.length > 200) base = base.slice(0, 200);
  return base;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safe = sanitizeOriginalName(file.originalname);
    // Also overwrite originalname so downstream code that uses it can't be tricked
    file.originalname = safe;
    cb(null, `${timestamp}-${safe}`);
  },
});

const videoFilter = (req, file, cb) => {
  const allowedExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only video files are allowed (mp4, mkv, avi, mov, webm, flv)'), false);
  }
};

const subtitleFilter = (req, file, cb) => {
  const allowedExts = ['.vtt', '.srt'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only subtitle files are allowed (vtt, srt)'), false);
  }
};

const thumbnailFilter = (req, file, cb) => {
  // SVG intentionally excluded — can embed <script>, runs when served directly
  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, PNG, GIF, WebP or BMP images are allowed'), false);
  }
};

const TEN_GB = 10 * 1024 * 1024 * 1024;
const TWO_MB = 2 * 1024 * 1024;
const TEN_MB = 10 * 1024 * 1024;

const videoUpload = multer({
  storage,
  limits: { fileSize: TEN_GB },
  fileFilter: videoFilter,
});

const subtitleUpload = multer({
  storage,
  limits: { fileSize: TWO_MB },
  fileFilter: subtitleFilter,
});

const thumbnailUpload = multer({
  storage,
  limits: { fileSize: TEN_MB },
  fileFilter: thumbnailFilter,
});

const uploadVideo = videoUpload.single('video');
const uploadSubtitle = subtitleUpload.single('subtitle');
const uploadThumbnail = thumbnailUpload.single('thumbnail');

module.exports = { uploadVideo, uploadSubtitle, uploadThumbnail };

const express = require('express');
const router = express.Router();
const db = require('../db/index');
const auth = require('../middleware/auth');

router.use(auth);

// GET / - List all folders with video count
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT f.*, COUNT(v.id)::int AS video_count
       FROM folders f
       LEFT JOIN videos v ON v.folder_id = f.id
       GROUP BY f.id
       ORDER BY f.name ASC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error listing folders:', err);
    res.status(500).json({ error: 'Failed to list folders' });
  }
});

// POST / - Create folder
router.post('/', async (req, res) => {
  try {
    const { name, parent_id } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    if (parent_id) {
      const parentResult = await db.query(
        'SELECT id FROM folders WHERE id = $1',
        [parent_id]
      );

      if (parentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Parent folder not found' });
      }
    }

    const result = await db.query(
      `INSERT INTO folders (name, parent_id, created_at)
       VALUES ($1, $2, NOW())
       RETURNING *`,
      [name.trim(), parent_id || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating folder:', err);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// PUT /:id - Update folder
router.put('/:id', async (req, res) => {
  try {
    const { name, parent_id } = req.body;

    const existing = await db.query(
      'SELECT * FROM folders WHERE id = $1',
      [req.params.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    if (parent_id && parent_id === parseInt(req.params.id)) {
      return res.status(400).json({ error: 'A folder cannot be its own parent' });
    }

    if (parent_id) {
      const parentResult = await db.query(
        'SELECT id FROM folders WHERE id = $1',
        [parent_id]
      );

      if (parentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Parent folder not found' });
      }
    }

    const result = await db.query(
      `UPDATE folders
       SET name = COALESCE($1, name),
           parent_id = $2
       WHERE id = $3
       RETURNING *`,
      [name, parent_id !== undefined ? parent_id : existing.rows[0].parent_id, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating folder:', err);
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

// DELETE /:id - Delete folder (videos get folder_id = null)
router.delete('/:id', async (req, res) => {
  try {
    const existing = await db.query(
      'SELECT * FROM folders WHERE id = $1',
      [req.params.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    await db.query(
      'UPDATE videos SET folder_id = NULL WHERE folder_id = $1',
      [req.params.id]
    );

    await db.query(
      'UPDATE folders SET parent_id = NULL WHERE parent_id = $1',
      [req.params.id]
    );

    await db.query(
      'DELETE FROM folders WHERE id = $1',
      [req.params.id]
    );

    res.json({ message: 'Folder deleted' });
  } catch (err) {
    console.error('Error deleting folder:', err);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// PUT /:id/move-video - Move a video to folder
router.put('/:id/move-video', async (req, res) => {
  try {
    const { video_id } = req.body;

    if (!video_id) {
      return res.status(400).json({ error: 'video_id is required' });
    }

    const folderResult = await db.query(
      'SELECT id FROM folders WHERE id = $1',
      [req.params.id]
    );

    if (folderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const videoResult = await db.query(
      'SELECT id FROM videos WHERE id = $1',
      [video_id]
    );

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const result = await db.query(
      `UPDATE videos SET folder_id = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [req.params.id, video_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error moving video:', err);
    res.status(500).json({ error: 'Failed to move video' });
  }
});

module.exports = router;

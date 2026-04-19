/**
 * Role-based access control middleware.
 *
 * Hierarchy: owner (3) > admin (2) > editor (1)
 *
 * Usage:
 *   router.use(requireMinRole('admin'))  — allows owner + admin
 *   router.use(requireRole('owner'))     — allows owner only
 */

const ROLE_LEVELS = { owner: 3, admin: 2, editor: 1 };

/**
 * Require the user to have at least the given role level.
 * owner >= admin >= editor
 */
function requireMinRole(minRole) {
  return (req, res, next) => {
    const userLevel = ROLE_LEVELS[req.admin?.role] || 0;
    const requiredLevel = ROLE_LEVELS[minRole] || 99;
    if (userLevel < requiredLevel) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/**
 * Require the user to have one of the specified roles exactly.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.admin?.role || !allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { requireMinRole, requireRole, ROLE_LEVELS };

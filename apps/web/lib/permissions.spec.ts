import { describe, expect, it } from 'vitest';
import {
  can,
  PERMISSIONS,
  PermissionError,
  requirePermission,
  roleLabel,
  rolesOf,
  type Permission,
} from './permissions';
import type { Viewer } from './session';

/**
 * Who may do what.
 *
 * The table itself is the security boundary in the dashboard: membership decides what a viewer can
 * see, and this decides what they can change. So what is pinned here is mostly the denials — a
 * permission accidentally granted is not something a build or a page render will notice.
 */

const viewer = (role: string) => ({ role }) as Viewer;

describe('can', () => {
  it('gives an owner everything', () => {
    for (const permission of PERMISSIONS) {
      expect(can(viewer('owner'), permission)).toBe(true);
    }
  });

  it('gives a member nothing', () => {
    // Read is not a permission here: it is membership, enforced by scoping every query through the
    // viewer's organization. This table only ever answers "may you change it".
    for (const permission of PERMISSIONS) {
      expect(can(viewer('member'), permission)).toBe(false);
    }
  });

  it('lets an admin run a project but not destroy one', () => {
    expect(can(viewer('admin'), 'project:write')).toBe(true);
    expect(can(viewer('admin'), 'project:keys')).toBe(true);
    expect(can(viewer('admin'), 'data:manage')).toBe(true);
    expect(can(viewer('admin'), 'members:manage')).toBe(true);
    expect(can(viewer('admin'), 'project:delete')).toBe(false);
  });

  it('reserves deleting a project to the owner', () => {
    expect(can(viewer('owner'), 'project:delete')).toBe(true);
    for (const role of ['admin', 'member']) {
      expect(can(viewer(role), 'project:delete')).toBe(false);
    }
  });

  it('reads a comma-separated role list, which is how Better Auth stores more than one', () => {
    // An owner who also holds another role reads as "owner,member". A plain equality check would
    // deny them everything, which is the kind of bug that looks like a broken page.
    expect(can(viewer('owner,member'), 'project:delete')).toBe(true);
    expect(can(viewer('member,admin'), 'project:write')).toBe(true);
    expect(can(viewer(' admin , member '), 'project:keys')).toBe(true);
  });

  it('denies a role it has never heard of', () => {
    // A role invented later must not silently inherit anything.
    expect(can(viewer('billing'), 'project:write')).toBe(false);
    expect(can(viewer(''), 'project:write')).toBe(false);
  });
});

describe('requirePermission', () => {
  it('says nothing when allowed', () => {
    expect(() =>
      requirePermission(viewer('admin'), 'project:write'),
    ).not.toThrow();
  });

  it('throws a refusal that names the permission', () => {
    expect(() => requirePermission(viewer('member'), 'project:write')).toThrow(
      PermissionError,
    );
    expect(() => requirePermission(viewer('member'), 'project:write')).toThrow(
      /project:write/,
    );
  });

  it('refuses every permission for a member, one at a time', () => {
    // The loop matters more than any single case: a permission added later is covered by this
    // without anyone remembering to extend the test.
    for (const permission of PERMISSIONS) {
      expect(() => requirePermission(viewer('member'), permission)).toThrow(
        PermissionError,
      );
    }
  });
});

describe('rolesOf', () => {
  it('splits and trims', () => {
    expect(rolesOf('owner, member')).toEqual(['owner', 'member']);
  });

  it('drops the empties rather than returning a blank role', () => {
    expect(rolesOf('')).toEqual([]);
    expect(rolesOf('owner,,')).toEqual(['owner']);
  });
});

describe('roleLabel', () => {
  it('shows the strongest role held', () => {
    expect(roleLabel('member,owner')).toBe('owner');
    expect(roleLabel('member,admin')).toBe('admin');
    expect(roleLabel('member')).toBe('member');
  });

  it('shows an unknown role as itself rather than pretending it is a member', () => {
    expect(roleLabel('billing')).toBe('billing');
  });
});

describe('the table itself', () => {
  it('grants nothing outside the declared permissions', () => {
    // Guards against a typo in a role's list quietly creating a permission nobody enforces.
    const declared = new Set<string>(PERMISSIONS);
    for (const role of ['owner', 'admin', 'member']) {
      for (const permission of PERMISSIONS) {
        if (can(viewer(role), permission))
          expect(declared.has(permission)).toBe(true);
      }
    }
  });

  it('has an owner set that is a superset of an admin set', () => {
    for (const permission of PERMISSIONS) {
      if (can(viewer('admin'), permission as Permission)) {
        expect(can(viewer('owner'), permission as Permission)).toBe(true);
      }
    }
  });
});

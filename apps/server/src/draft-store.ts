// Ephemeral draft storage — the YAML the operator is currently editing but
// hasn't deployed yet. MVP scope: in-memory, single shared slot per user
// (single-user Miharbor). Stage 2 replaces this with a per-tab uuid so two
// operators don't silently overwrite each other.
//
// Why in-memory instead of disk?
//   - Drafts must NOT survive a Miharbor restart — if something crashes,
//     the operator's WIP is lost but the live config + snapshot history
//     remain the source of truth. That prevents subtle "I don't remember
//     what I was editing" surprises after a container restart.
//   - Drafts hold raw secrets (operator pasted new WG private-key, etc.);
//     writing them to disk outside the vault would widen the attack
//     surface. In-memory means `/proc/<pid>/mem` is the only exposure.

export interface DraftEntry {
  /** The current draft text. */
  text: string
  /** When this draft was last updated. */
  updated: string
  /** Who set this draft (from the auth user). */
  by: string
}

export interface DraftStore {
  /** Return the draft for `user`, or `null` if none. */
  get(user: string): DraftEntry | null
  /** Replace the draft for `user`. */
  put(user: string, text: string): DraftEntry
  /** Drop `user`'s draft (called by deploy on success). */
  clear(user: string): void
  /** Number of drafts currently stored. */
  size(): number
}

export function createDraftStore(): DraftStore {
  const drafts = new Map<string, DraftEntry>()
  return {
    get(user) {
      return drafts.get(user) ?? null
    },
    put(user, text) {
      const entry: DraftEntry = {
        text,
        updated: new Date().toISOString(),
        by: user,
      }
      drafts.set(user, entry)
      return entry
    },
    clear(user) {
      drafts.delete(user)
    },
    size() {
      return drafts.size
    },
  }
}

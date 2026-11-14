import type { OutboxStore } from "./types";

// Signing a rep out of this phone (P1-09, NFR-01, plan task 10). What the outbox keeps for that
// rep is wiped before the session ends, so the next person at the phone finds nothing of theirs.
// Unsent work is never dropped without its owner saying so: with anything unsent, or when the
// phone cannot tell, the first call only asks, and nothing changes until the rep confirms. Only
// the signing-out login's own items are counted and removed: another login's held work stays,
// sealed, and can be read only with that login's session (access.ts). And nothing is removed
// unless the session can be ended now: a wipe cannot be undone, a failed sign-out can be retried.

export type SignOutDeps = {
  /** How many unsent actions (waiting or refused) the wipe would remove. */
  unsent(): Promise<number>;
  /** Why the session cannot be ended right now, or null when it can. Asked before anything is counted or removed. */
  blocked(): Promise<string | null>;
  /** Removes what the outbox keeps on this phone for the login that is signing out. */
  wipe(): Promise<void>;
  /** Ends the session on this phone. Throws when it could not be ended. */
  endSession(): Promise<void>;
  /** Drops the rep remembered for saving out of signal. */
  forget(): void;
};

export type SignOutOutcome =
  /** Nothing was changed and the rep is still signed in. `unsent` is null when the phone could not count. */
  | { kind: "confirm"; unsent: number | null; reason: string | null }
  /** The session has ended. `wipeError` says why the phone could not be cleared, or is null when it was. */
  | { kind: "signed-out"; wipeError: string | null }
  /** The session could not be ended. `wiped` says whether the phone was cleared before that. */
  | { kind: "failed"; message: string; wiped: boolean };

export const CANNOT_END =
  "no signal, and this phone's sign-in has run out, so it can be neither renewed nor ended until the signal is back; nothing was removed from this phone";

const wordsOf = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message : fallback;

/**
 * The count and the wipe for one login: `who` is the login whose session the phone holds, or null
 * when it holds none. With nobody to sign out nothing is counted and nothing is removed.
 */
export const ownOutbox = (
  store: () => Promise<OutboxStore>,
  who: () => Promise<string | null>,
): Pick<SignOutDeps, "unsent" | "wipe"> => ({
  unsent: async () => {
    const userId = await who();
    return userId ? (await store()).countOf(userId) : 0;
  },
  wipe: async () => {
    const userId = await who();
    if (userId) await (await store()).clearOf(userId);
  },
});

/**
 * Signs out of this phone. Call with `discardUnsent` false first; a "confirm" outcome means the rep
 * must be asked, and only their yes calls this again with true.
 */
export async function signOutOfPhone(deps: SignOutDeps, discardUnsent: boolean): Promise<SignOutOutcome> {
  try {
    const blocked = await deps.blocked();
    if (blocked !== null) return { kind: "failed", message: blocked, wiped: false };
  } catch (error) {
    return { kind: "failed", message: wordsOf(error, "the session could not be read"), wiped: false };
  }
  if (!discardUnsent) {
    try {
      const unsent = await deps.unsent();
      if (unsent > 0) return { kind: "confirm", unsent, reason: null };
    } catch (error) {
      return { kind: "confirm", unsent: null, reason: wordsOf(error, "the phone's storage did not answer") };
    }
  }
  let wipeError: string | null = null;
  try {
    await deps.wipe();
  } catch (error) {
    // A phone that cannot be cleared must not keep the rep signed in: ending the session matters more.
    wipeError = wordsOf(error, "the phone's storage did not answer");
  }
  try {
    await deps.endSession();
  } catch (error) {
    // Rare after the check above (the session changed in between). The rep is still signed in and
    // is not forgotten, so saving out of signal still finds its owner.
    return { kind: "failed", message: wordsOf(error, "the session could not be ended"), wiped: wipeError === null };
  }
  // Last: a page still open may have read the session again after the wipe and remembered the rep.
  deps.forget();
  return { kind: "signed-out", wipeError };
}

/** What the rep is asked before unsent work is removed. */
export function signOutQuestion(outcome: Extract<SignOutOutcome, { kind: "confirm" }>): string {
  if (outcome.unsent === null) {
    return `This phone could not check for unsent work (${outcome.reason ?? "no reason was given"}). If anything is waiting, signing out may remove it for good.`;
  }
  const one = outcome.unsent === 1;
  return `This phone is holding ${outcome.unsent} ${one ? "action that was" : "actions that were"} not sent. Signing out removes ${one ? "it" : "them"} from this phone for good, and ${one ? "it" : "they"} will never be sent.`;
}

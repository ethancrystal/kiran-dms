// Signing a rep out of this phone (P1-09, NFR-01, plan task 10). What the outbox keeps is wiped
// before the session ends, so the next person at the phone finds nothing. Unsent work is never
// dropped without the rep saying so: with anything unsent, or when the phone cannot tell, the first
// call only asks, and nothing changes until the rep confirms.

export type SignOutDeps = {
  /** How many unsent actions (waiting or refused) this phone holds, for any login: the wipe removes them all. */
  unsent(): Promise<number>;
  /** Removes everything the outbox keeps on this phone. */
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

const wordsOf = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message : fallback;

/**
 * Signs out of this phone. Call with `discardUnsent` false first; a "confirm" outcome means the rep
 * must be asked, and only their yes calls this again with true.
 */
export async function signOutOfPhone(deps: SignOutDeps, discardUnsent: boolean): Promise<SignOutOutcome> {
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

import { sumCents } from "../../util/money.ts";

/** A posting on the ledger. */
export interface Posting {
  account: string;
  amountCents: number;
}

/** True when the postings balance to zero. */
export function balances(postings: Posting[]): boolean {
  return sumCents(postings.map((posting) => posting.amountCents)) === 0;
}

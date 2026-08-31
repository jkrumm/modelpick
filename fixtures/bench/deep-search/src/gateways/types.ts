/** A payment gateway adapter as the rest of the code sees it. */
export interface Gateway {
  id: string;
  label: string;
  retries: number;
  settles: boolean;
}

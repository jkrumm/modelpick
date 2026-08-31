/** The EAN-13 check digit for a 12-digit body. */
export function checkDigit(body: string): number {
  let sum = 0;
  for (let index = 0; index < body.length; index++) {
    sum += Number(body[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

// Деньги хранятся в тиынах (BigInt). 1 тенге = 100 тиын. Никогда float.

// Парсит ввод в тенге («350 000», «350000.50», «1 234,56») в тиыны (BigInt).
// Бросает, если строка не похожа на сумму.
export function parseTengeToTiyn(input: string): bigint {
  const cleaned = input.replace(/\s/g, "").replace(",", ".").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error("Некорректная сумма");
  }
  const [intPart, fracPartRaw = ""] = cleaned.split(".");
  const fracPart = (fracPartRaw + "00").slice(0, 2); // дополняем до тиынов
  return BigInt(intPart) * 100n + BigInt(fracPart);
}

// Форматирует тиыны в строку тенге с разделителями: 35000000n → «350 000 ₸».
// Копейки показываются, только если они есть.
export function formatTiyn(tiyn: bigint): string {
  const sign = tiyn < 0n ? "-" : "";
  const abs = tiyn < 0n ? -tiyn : tiyn;
  const tenge = abs / 100n;
  const kopeck = abs % 100n;

  const tengeStr = tenge
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " "); // неразрывный пробел

  const kopeckStr = kopeck > 0n ? "," + kopeck.toString().padStart(2, "0") : "";
  return `${sign}${tengeStr}${kopeckStr} ₸`;
}

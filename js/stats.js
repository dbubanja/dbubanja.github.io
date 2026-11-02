// Анонимни бројач коришћења (GoatCounter, без колачића, без скрипте треће стране).
// Шаље се САМО: назив догађаја (нпр. „/otvaranje“) и величина екрана.
// Никад се не шаљу имена дужника, износи, датуми ни било који подаци обрачуна.

export const GOATCOUNTER_CODE = 'zateznakamata'; // https://zateznakamata.goatcounter.com

export function countEvent(path, enabled = true) {
  try {
    if (!enabled || !GOATCOUNTER_CODE || !navigator.onLine) return;
    if (navigator.webdriver) return; // аутоматизовани тестови се не броје
    const q = new URLSearchParams({
      p: path,
      t: 'Затезна камата ЦГ',
      s: `${screen.width},${screen.height},${window.devicePixelRatio || 1}`,
      rnd: Math.random().toString(36).slice(2),
    });
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.src = `https://${GOATCOUNTER_CODE}.goatcounter.com/count?${q}`;
  } catch { /* бројач никад не смије сметати раду */ }
}

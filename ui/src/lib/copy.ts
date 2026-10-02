// Copy text to the clipboard, with the old way as a fallback where the page has
// no clipboard access (an insecure page, or a denied permission).

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    // Inside an open dialog, since the page behind one can't take focus.
    (document.querySelector('[role=dialog]') || document.body).append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    area.remove();
    return ok;
  }
}

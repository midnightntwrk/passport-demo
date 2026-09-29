import { createPassport } from '@midnight-passport/connect';

import { signIn, type SignInView } from './connect';

/* The exact Passport origin. No default in the package, on purpose; this one
   falls back to production so the example runs with no configuration. */
const PASSPORT_ORIGIN = import.meta.env.VITE_PASSPORT_ORIGIN || 'https://midnightpassport.com';

/* One client per page, kept for the life of the page: two clients are two
   message listeners, both claiming the same Passport window. */
const passport = createPassport({ origin: PASSPORT_ORIGIN });

const button = document.querySelector<HTMLButtonElement>('#connect')!;
const output = document.querySelector<HTMLDivElement>('#result')!;
document.querySelector('#origin')!.textContent = passport.origin;

function render(view: SignInView): void {
  switch (view.kind) {
    case 'signed-in': {
      const lines = [view.name ? `Signed in as ${view.name}.` : 'Signed in. Your name was not shared.'];
      if (view.account) lines.push(`Account: ${view.account.address} (${view.account.network})`);
      if (view.withheld.length > 0) lines.push(`Not shared: ${view.withheld.join(', ')}.`);
      output.textContent = lines.join('\n');
      return;
    }
    case 'refused':
    case 'not-sent':
      /* Always the package's own sentence, never a bare code. */
      output.textContent = view.message;
      return;
  }
}

button.addEventListener('click', async () => {
  /* Called straight from the click: the pop-up needs this user gesture. */
  button.disabled = true;
  output.textContent = 'Waiting for Passport…';
  try {
    render(await signIn(passport));
  } finally {
    button.disabled = false;
  }
});

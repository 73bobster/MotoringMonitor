// Signed-out screens: sign in, create account (with invitation), reset password, join with a code.
import * as api from './api.js';
import { html, mount, on, plate, toast, logoImg, wireLogos } from './ui.js';
import { applyBrand } from './shell.js';
import { CONFIG } from './config.js';

const root = () => document.getElementById('app');

function frame(inner) {
  applyBrand(null);
  mount(root(), html`
    <div class="auth">
      <aside class="auth-side" aria-hidden="true">
        <div class="auth-banners"><span class="banner">Every MOT</span><span class="banner">Every licence</span><span class="banner">Every renewal</span></div>
        <p class="auth-line">Fleet compliance for ${CONFIG.brand?.name || 'your business'}, in one place.</p>
        <div class="auth-plates">${plate('AB12 CDE')}${plate('FM26 MOT')}${plate('XY74 LIC')}</div>
      </aside>
      <main class="auth-main" id="main"><div class="auth-card">${logoImg(CONFIG.brand?.logoUrl, CONFIG.brand?.name || 'FleetMonitor')}${inner}</div></main>
    </div>`);
  wireLogos(root());
}

function wireForm(handler) {
  const form = root().querySelector('form');
  const err = root().querySelector('.form-error');
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try { await handler(form); } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  };
  form.querySelector('input')?.focus();
}

const redirectUrl = (invite) => `${location.origin}${location.pathname}${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`;

export function showAuth({ mode = 'signin', invite = null, notice = '' } = {}) {
  const signup = mode === 'signup';
  const forgot = mode === 'forgot';
  frame(html`
    <h1>${forgot ? 'Reset your password' : signup ? 'Create your account' : 'Sign in'}</h1>
    ${invite && signup ? html`<p class="notice">You've been invited to join. Create your account with the email address the invitation was sent to.</p>` : ''}
    ${notice ? html`<p class="notice">${notice}</p>` : ''}
    <form class="stack">
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username" inputmode="email"></div>
      ${forgot ? '' : html`<div class="field"><label for="password">Password</label><input id="password" name="password" type="password" required minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}">${signup ? html`<p class="hint">At least 8 characters.</p>` : ''}</div>`}
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">${forgot ? 'Send reset link' : signup ? 'Create account' : 'Sign in'}</button>
    </form>
    <p class="auth-alt">${forgot
      ? html`<button class="link" data-action="signin">Back to sign in</button>`
      : signup
        ? html`Already have an account? <button class="link" data-action="signin">Sign in</button>`
        : html`<button class="link" data-action="forgot">Forgot your password?</button><br>New here? <button class="link" data-action="signup">Create an account</button>`}</p>`);
  on(root(), {
    signin: () => showAuth({ mode: 'signin', invite }),
    signup: () => showAuth({ mode: 'signup', invite }),
    forgot: () => showAuth({ mode: 'forgot', invite }),
  });
  wireForm(async (form) => {
    const email = form.elements.email.value.trim().toLowerCase();
    if (forgot) {
      await api.auth.resetPassword(email, redirectUrl(invite));
      showAuth({ mode: 'signin', invite, notice: 'If an account exists for that email, a reset link is on its way.' });
    } else if (signup) {
      const data = await api.auth.signUp(email, form.elements.password.value, redirectUrl(invite));
      if (!data.session) showCheckEmail(email, invite);
    } else {
      await api.auth.signIn(email, form.elements.password.value);
    }
  });
}

export function showCheckEmail(email, invite) {
  frame(html`
    <h1>Check your email</h1>
    <p>We sent a confirmation link to <strong>${email}</strong>. Open it to confirm your address, then sign in.</p>
    ${invite ? html`<p class="hint">Your invitation is saved. It will be applied when you sign in.</p>` : ''}
    <p class="auth-alt"><button class="link" data-action="signin">Back to sign in</button></p>`);
  on(root(), { signin: () => showAuth({ mode: 'signin', invite }) });
}

export function showRecovery(onDone) {
  frame(html`
    <h1>Choose a new password</h1>
    <form class="stack">
      <div class="field"><label for="password">New password</label><input id="password" name="password" type="password" required minlength="8" autocomplete="new-password"><p class="hint">At least 8 characters.</p></div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Save password</button>
    </form>`);
  wireForm(async (form) => {
    await api.auth.updatePassword(form.elements.password.value);
    toast('Password updated.');
    await onDone();
  });
}

// Signed in, but not a member of any organisation yet.
export function showNoAccess({ email, onJoin, onSignOut, error = '' }) {
  frame(html`
    <h1>You're signed in, but not part of an organisation yet</h1>
    <p>You're signed in as <strong>${email}</strong>. Ask your administrator to invite this email address, then enter the invitation code you were given.</p>
    ${error ? html`<p class="form-error" role="alert">${error}</p>` : ''}
    <form class="stack">
      <div class="field"><label for="code">Invitation code</label><input id="code" name="code" type="text" required autocomplete="off" spellcheck="false" placeholder="Paste your invitation code"></div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Join organisation</button>
    </form>
    <p class="auth-alt"><button class="link" data-action="signout">Sign out</button></p>`);
  on(root(), { signout: () => onSignOut() });
  wireForm(async (form) => { await onJoin(form.elements.code.value.trim()); });
}

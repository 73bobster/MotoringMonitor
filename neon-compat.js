// neon-compat.js — shared by MotoringMonitor, MotoringSOS and LeasedMileage.
// Creates the Neon client (Supabase-style API) and provides the small bits
// the Neon library doesn't: file storage (kept in the file_blobs table) and
// password reset by emailed token.
(function () {
  const BASE_URL = 'https://ep-holy-dawn-zav24ic8.c-2.eu-west-2.aws.neon.tech/neondb';
  const AUTH_URL = 'https://ep-holy-dawn-zav24ic8.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth';
  const client = window.NeonJS.createClient(BASE_URL, { auth: { allowAnonymous: true } });

  function recoveryToken() {
    return new URLSearchParams(location.search).get('token');
  }

  async function resetPassword(newPassword) {
    const tok = recoveryToken();
    if (!tok) return { error: { message: 'Reset link is missing or expired. Request a new one.' } };
    try {
      const r = await fetch(AUTH_URL + '/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword, token: tok }),
      });
      if (!r.ok) {
        let msg = 'Could not reset password.';
        try { const j = await r.json(); msg = j.message || msg; } catch (e) {}
        return { error: { message: msg } };
      }
      history.replaceState(null, '', location.pathname);
      return { error: null };
    } catch (e) { return { error: { message: e.message } }; }
  }

  // Shrink photos in the browser so they store and load quickly.
  async function shrinkImage(file) {
    if (!file.type || !file.type.startsWith('image/')) return file;
    try {
      const bmp = await createImageBitmap(file);
      const max = 1600;
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.8));
      return blob && blob.size < file.size ? blob : file;
    } catch (e) { return file; }
  }

  function toDataUrl(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  const storage = {
    async put(path, file, householdId) {
      const blob = await shrinkImage(file);
      if (blob.size > 8 * 1024 * 1024) throw new Error('File is too large (limit 8 MB).');
      const data = await toDataUrl(blob);
      const { error } = await client.from('file_blobs').insert({
        path, household_id: householdId || null, content_type: blob.type || file.type || null, data,
      });
      if (error) throw error;
      return { size: blob.size };
    },
    // Returns a URL the browser can open or use as an <img> source.
    async getUrl(path) {
      const { data, error } = await client.from('file_blobs').select('data').eq('path', path).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('File not found');
      const blob = await (await fetch(data.data)).blob();
      return URL.createObjectURL(blob);
    },
    async remove(path) {
      await client.from('file_blobs').delete().eq('path', path);
    },
  };

  window.NeonCompat = { client, recoveryToken, resetPassword, storage };
})();

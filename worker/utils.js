import crypto from 'node:crypto';

export const generateClientId = () => {
  try {
    return (crypto.randomBytes(8).toString('hex'));
  } catch (error) {
    logEvent('generateClientId', error, 'error');
    return (null);
  }
};

export const encryptMessage = (message, key) => {

  let encrypted = '';

  try {

    const messageBuffer = Buffer.from(JSON.stringify(message), 'utf8');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('nodecrypt-server-v1', 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(messageBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    encrypted = iv.toString('base64') + '|' + Buffer.concat([ciphertext, authTag]).toString('base64');

  } catch (error) {
    logEvent('encryptMessage', error, 'error');
  }

  return (encrypted);

};

export const decryptMessage = (message, key) => {

  let decrypted = {};

  try {

    const parts = message.split('|');
    if (parts.length !== 2) {
      return decrypted;
    }
    const iv = Buffer.from(parts[0], 'base64');
    const encryptedBytes = Buffer.from(parts[1], 'base64');
    if (encryptedBytes.length <= 16) {
      return decrypted;
    }
    const ciphertext = encryptedBytes.subarray(0, encryptedBytes.length - 16);
    const authTag = encryptedBytes.subarray(encryptedBytes.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from('nodecrypt-server-v1', 'utf8'));
    decipher.setAuthTag(authTag);
    const decryptedBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    decrypted = JSON.parse(decryptedBuffer.toString('utf8'));

  } catch (error) {
    logEvent('decryptMessage', error, 'error');
  }

  return (decrypted);

};

export const logEvent = (source, message, level) => {
  const debugEnabled = (globalThis && globalThis.NODECRYPT_DEBUG === true);
  if (
    level !== 'debug' ||
    debugEnabled
  ) {

    const date = new Date(),
      dateString = date.getFullYear() + '-' +
      ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
      ('0' + date.getDate()).slice(-2) + ' ' +
      ('0' + date.getHours()).slice(-2) + ':' +
      ('0' + date.getMinutes()).slice(-2) + ':' +
      ('0' + date.getSeconds()).slice(-2);

    let safeMessage = message;
    if (typeof safeMessage === 'string' && safeMessage.length > 256) {
      safeMessage = safeMessage.slice(0, 256) + '...[truncated]';
    }
    console.log('[' + dateString + ']', (level ? level.toUpperCase() : 'INFO'), source + (safeMessage ? ':' : ''), (safeMessage ? safeMessage : ''));

  }
};

export const getTime = () => {
  return (new Date().getTime());
};

export const isString = (value) => {
  return (
    value &&
    Object.prototype.toString.call(value) === '[object String]' ?
    true :
    false
  );
};

export const isArray = (value) => {
  return (
    value &&
    Object.prototype.toString.call(value) === '[object Array]' ?
    true :
    false
  );
};

export const isObject = (value) => {
  return (
    value &&
    Object.prototype.toString.call(value) === '[object Object]' ?
    true :
    false
  );
};

// Note: Since Cloudflare Workers don't have access to global.gc,
// we're not including the garbage collection interval that's in server.js
// setInterval(() => {
//   if (global.gc) {
//     global.gc();
//   }
// }, 30000);
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { messagePushTarget, messagePushText } = require('../../functions/messages.js');

const job = { task: 'Rack and stack', client: 'Acme', assignedTechEmail: 'tech@example.com' };

describe('messagePushTarget', () => {
  it('sends a staff message to the assigned tech', () => {
    expect(messagePushTarget({ authorRole: 'admin' }, job)).toEqual({ email: 'tech@example.com' });
    expect(messagePushTarget({ authorRole: 'adminAssistant' }, job)).toEqual({ email: 'tech@example.com' });
  });

  it('sends nothing for a staff message on an unassigned job', () => {
    expect(messagePushTarget({ authorRole: 'admin' }, { client: 'Acme' })).toBeNull();
  });

  it('sends a tech or senior consultant message to admins and admin assistants', () => {
    expect(messagePushTarget({ authorRole: 'tech' }, job)).toEqual({ roles: ['admin', 'adminAssistant'] });
    expect(messagePushTarget({ authorRole: 'seniorConsultant' }, job)).toEqual({ roles: ['admin', 'adminAssistant'] });
  });
});

describe('messagePushText', () => {
  it('names the job and author and previews the message', () => {
    expect(messagePushText({ text: 'Dock is open', authorName: 'Ada' }, job)).toEqual({
      title: 'Message: Rack and stack',
      body: 'Ada: Dock is open',
    });
  });

  it('truncates long messages and falls back to the client name', () => {
    const { title, body } = messagePushText({ text: 'x'.repeat(300), authorEmail: 'a@b.c' }, { client: 'Acme' });
    expect(title).toBe('Message: Acme');
    expect(body.startsWith('a@b.c: ')).toBe(true);
    expect(body.length).toBeLessThanOrEqual('a@b.c: '.length + 120);
  });
});

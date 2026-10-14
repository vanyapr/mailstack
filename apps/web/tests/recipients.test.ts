import test from 'node:test';
import assert from 'node:assert/strict';
import { commitRecipients, recipientValues, serializeRecipients } from '../src/features/mail/recipients';

test('recipient values split delimiters and discard case-insensitive duplicates',()=>{
  assert.deepEqual(recipientValues(' anna@localhost; BOB@localhost, anna@LOCALHOST '),['anna@localhost','BOB@localhost']);
  assert.equal(serializeRecipients(['anna@localhost','BOB@localhost','anna@LOCALHOST']),'anna@localhost, BOB@localhost');
});

test('enter-style recipient commit adds multiple valid email addresses',()=>{
  assert.deepEqual(commitRecipients(['anna@localhost'],'boris@localhost; clara@example.test'),{values:['anna@localhost','boris@localhost','clara@example.test']});
});

test('recipient commit retains the previous chips when a value is not an email address',()=>{
  assert.deepEqual(commitRecipients(['anna@localhost'],'not-an-address'),{values:['anna@localhost'],error:'Укажите корректный email-адрес.'});
});

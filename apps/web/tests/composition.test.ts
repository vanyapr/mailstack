import test from 'node:test';
import assert from 'node:assert/strict';
import {compositionFor,hasDraftContent} from '../src/features/mail/composition';
import type {Message} from '../src/lib/mox/mail';
const source:Message={id:12,folder:1,sender:'Борис',email:'boris@localhost',replyTo:'support@localhost',to:'ALICE@localhost, team@localhost',cc:'team@localhost, colleague@localhost',bcc:'',subject:'Обсуждение',date:'2026-10-13T12:00:00Z',texts:['Первая строка','Вторая строка'],hasHTML:false,unread:false,flagged:false,draft:false,messageID:'test@localhost',preview:'',attachments:[]};
test('reply fills Reply-To, subject, original sender and quote',()=>{
  const draft=compositionFor('reply',source,'alice@localhost','Подпись');
  assert.equal(draft.to,'support@localhost');assert.equal(draft.subject,'Re: Обсуждение');assert.equal(draft.replyToId,12);assert.match(draft.text,/Борис <boris@localhost>/);assert.match(draft.text,/> Первая строка\n> Вторая строка/);assert.match(draft.text,/Подпись/);
});
test('reply uses sender without Reply-To; reply-all excludes self and duplicates',()=>{
  const draft=compositionFor('all',{...source,replyTo:'',subject:'Re: Обсуждение'},'alice@localhost','');
  assert.equal(draft.to,'boris@localhost');assert.equal(draft.cc,'team@localhost, colleague@localhost');assert.equal(draft.subject,'Re: Обсуждение');
});
test('blank composer or signature-only composer can become a reply',()=>{
  assert.equal(hasDraftContent(compositionFor('new',null,'alice@localhost',''),'Подпись'),false);
  assert.equal(hasDraftContent(compositionFor('new',null,'alice@localhost','Подпись'),'Подпись'),false);
  const draft=compositionFor('new',null,'alice@localhost','');
  for(const patch of [{to:'other@localhost'},{subject:'Не потерять'},{text:'Несохранённый текст'},{files:[new File(['test'],'test.txt')]}])assert.equal(hasDraftContent({...draft,...patch},''),true);
});
test('forward keeps reference and quote, recipient stays intentionally empty',()=>{
  const draft=compositionFor('forward',source,'alice@localhost','');assert.equal(draft.to,'');assert.equal(draft.forward,true);assert.equal(draft.replyToId,source.id);assert.equal(draft.subject,'Fwd: Обсуждение');
});

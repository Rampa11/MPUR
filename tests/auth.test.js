import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adminConfigured,credentialsMatch,createSession,readSession} from '../auth.js';
test('admin access fails closed until strong secrets are configured',()=>{
 const env={password:process.env.ADMIN_PASSWORD,secret:process.env.SESSION_SECRET,username:process.env.ADMIN_USERNAME};
 try{delete process.env.ADMIN_PASSWORD;delete process.env.SESSION_SECRET;assert.equal(adminConfigured(),false);assert.equal(readSession('fake'),null);
 process.env.ADMIN_PASSWORD='unit-test-password-123';process.env.SESSION_SECRET='test-session-secret-with-more-than-32-characters';process.env.ADMIN_USERNAME='reviewer';
 assert.equal(credentialsMatch('reviewer','unit-test-password-123'),true);assert.equal(credentialsMatch('reviewer','wrong'),false);assert.equal(credentialsMatch('other','unit-test-password-123'),false);
 const token=createSession('reviewer',1000);assert.equal(readSession(token,2000).username,'reviewer');assert.equal(readSession(token,1000+8*60*60*1000),null);
 assert.equal(readSession(token.slice(0,-4)+'abcd',2000),null);process.env.SESSION_SECRET='a-new-secret-with-more-than-32-characters';assert.equal(readSession(token,2000),null);
 }finally{for(const [key,value] of Object.entries({ADMIN_PASSWORD:env.password,SESSION_SECRET:env.secret,ADMIN_USERNAME:env.username})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

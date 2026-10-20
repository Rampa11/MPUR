import {createHmac,createHash,timingSafeEqual,randomBytes} from 'node:crypto';
const cookieName='mpur_admin';
export const adminConfigured=()=>Boolean(process.env.ADMIN_PASSWORD?.length>=16&&process.env.SESSION_SECRET?.length>=32);
const digest=value=>createHash('sha256').update(String(value)).digest();
export function credentialsMatch(username,password){return adminConfigured()&&typeof username==='string'&&typeof password==='string'&&timingSafeEqual(digest(username),digest(process.env.ADMIN_USERNAME||'admin'))&&timingSafeEqual(digest(password),digest(process.env.ADMIN_PASSWORD));}
export function createSession(username,now=Date.now()){
 const payload=Buffer.from(JSON.stringify({username,expires:now+8*60*60*1000,nonce:randomBytes(16).toString('hex')})).toString('base64url');
 return payload+'.'+createHmac('sha256',process.env.SESSION_SECRET).update(payload).digest('base64url');
}
export function readSession(token,now=Date.now()){
 if(!adminConfigured()||typeof token!=='string'||token.length>2048)return null;
 try{const [payload,signature,...extra]=token.split('.');if(extra.length||!signature)return null;const expected=createHmac('sha256',process.env.SESSION_SECRET).update(payload).digest();const actual=Buffer.from(signature,'base64url');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;const data=JSON.parse(Buffer.from(payload,'base64url'));return data.expires>now&&data.username===(process.env.ADMIN_USERNAME||'admin')?data:null;}catch{return null;}
}
export function sessionFromRequest(req){const cookies=String(req.headers.cookie||'').split(';').map(s=>s.trim());const token=cookies.find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);return readSession(token);}
export function requireAdmin(req,res,next){const session=sessionFromRequest(req);if(!session)return res.status(401).json({error:'Sign in as an administrator.'});req.admin=session.username;next();}
export function requireAdminRequest(req,res,next){
 if(req.get('X-MPUR-Admin')!=='1')return res.status(403).json({error:'Invalid admin request.'});
 const origin=req.get('origin');if(origin&&origin!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'Cross-site requests are not allowed.'});next();
}
export function setSessionCookie(req,res,value,clear=false){res.cookie(cookieName,value,{httpOnly:true,secure:req.secure||process.env.NODE_ENV==='production',sameSite:'strict',path:'/api',maxAge:clear?0:8*60*60*1000});}

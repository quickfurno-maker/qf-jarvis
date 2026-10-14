// VOX-10C composition adapter: reuse the existing Jarvis database pool.
import {verifyOnceAgentView} from './verifyOnce.mjs';
import {createPostgresReplayStore} from './postgresReplay.mjs';
/** Strictly backend-owned entrypoint. Only a read-only agent status projection
 * can be returned. Does not start an HTTP server, worker or send provider data. */
export function createDatabaseBackedVoxAgentVerifier({pool,secret,clock=()=>Math.floor(Date.now()/1000)}){
 if(!pool||typeof pool.query!=="function")throw Error("EXISTING_JARVIS_POOL_REQUIRED");
 if(typeof secret!=="string"||secret.length<32)throw Error("SIGNING_KEY_REQUIRED");
 if(typeof clock!=="function")throw Error("CLOCK_REQUIRED");
 const store=createPostgresReplayStore(pool);
 return Object.freeze({
  async verifySignedView(token){
   const now=clock();
   if(!Number.isSafeInteger(now))throw Error("INVALID_CLOCK");
   const event=await verifyOnceAgentView(token,secret,store,now);
   if(event.proofConsumed!==true||
      event.permissions?.length!==1||event.permissions[0]!=="READ_ONLY")throw Error("INVALID_ADVISORY");
   return event;
  },
 });
}

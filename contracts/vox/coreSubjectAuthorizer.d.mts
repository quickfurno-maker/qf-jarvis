export declare function createVoxCoreSubjectAuthorizer(options:{
 coreOrigin:string;fetchImpl?:typeof fetch;timeoutMs?:number;
}):(request:Readonly<{requesterBearer:string;agent:string;channel:string;subjectType:string;subjectId:string;revision:number}>)=>Promise<unknown>;

/** A provider response failed an explicit output contract, not a source or infrastructure invariant. */
export class InvalidAssessmentOutput extends Error {
  constructor(message:string, readonly stage:string|null=null, options?:ErrorOptions) { super(message,options); }
  atStage(stage:string):InvalidAssessmentOutput { return this.stage ? this : new InvalidAssessmentOutput(this.message,stage,{cause:this}); }
}

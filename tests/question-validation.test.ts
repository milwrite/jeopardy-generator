import assert from 'node:assert/strict';
import test from 'node:test';
import { validateQuestionRule } from '../src/questionValidation';

test('specific live model clues do not fail for response grammar or a city descriptor',()=>{
  assert.equal(validateQuestionRule('World Cities','This city, located on the Thames River, is the capital of the United Kingdom.','What is London?').valid,true);
  assert.equal(validateQuestionRule('Birds','This bird of prey is often used as a symbol of the United States and has a white head and tail.','What is the bald eagle?').valid,true);
});

test('answer leaks, missing specifics, and incorrect response forms remain rejected',()=>{
  assert.equal(validateQuestionRule('Capitals','Paris sits on the Seine River.','What is Paris?').valid,false);
  assert.equal(validateQuestionRule('Places','This city is known for its rich history.','What is Paris?').valid,false);
  assert.equal(validateQuestionRule('Capitals','The seat of government of France.','Paris').valid,false);
  assert.equal(validateQuestionRule('Capitals','Which municipality is the seat of government of France?','What is Paris?').valid,false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosSignature } from '../src/storage.js';

test('腾讯云 COS 官方 PUT 示例的请求签名', () => {
  const result = cosSignature('PUT','/exampleobject(腾讯云)',{
    'content-length':'13','content-md5':'mQ/fVh815F3k6TAUm8m0eg==','content-type':'text/plain',
    date:'Thu, 16 May 2019 06:45:51 GMT',host:'examplebucket-1250000000.cos.ap-beijing.myqcloud.com',
    'x-cos-acl':'private','x-cos-grant-read':'uin="100000000011"',
  },'1557989151;1557996351','eb2519b498b02ac213cb1f3d1a3d27a3b3c9bc5f');
  // 官方示例末四位做了替换；完整摘要用其公开 StringToSign 独立复算。
  assert.equal(result.signature,'3b8851a11a569213c17ba8fa7dcf2abec6935172');
});

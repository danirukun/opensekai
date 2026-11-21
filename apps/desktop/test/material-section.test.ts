import {expect,it} from 'vitest';
import type {AssetMaterial} from '@opensekai/contracts';
import {materialChoices,materialRows,showsMaterials} from '../src/editor/materials';

// B38 R29: the rows of the Inspector Materials section.
const record:AssetMaterial[]=[
 {index:0,name:'Skin',profile:'mtoon',blend:false,outline:true,model:{baseColor:'#ffe0d0',shadeColor:'#c09080',rimColor:'#000000',outlineColor:'#202020',outlineWidth:0.01}},
 {index:1,name:'Glass',profile:'pbr',blend:true,outline:false,model:{baseColor:'#ffffff',opacity:0.4,emissionColor:'#000000',emissionStrength:1}},
 {index:2,name:'Hair',profile:'liltoon',blend:false,outline:false,model:{}},
];

it('lists the record materials in file order, then the saved names that the record does not have',()=>{
 expect(materialChoices(record,{Old:{baseColor:'#ff0000'},Glass:{opacity:1}})).toEqual([
  {value:'Skin',label:'Skin',missing:false},
  {value:'Glass',label:'Glass',missing:false},
  {value:'Hair',label:'Hair',missing:false},
  {value:'Old',label:'Old (Missing)',missing:true},
 ]);
 expect(materialChoices(undefined,undefined)).toEqual([]);
});

it('shows the parameters that apply in R14 order with the saved value or else the model value',()=>{
 const rows=materialRows(record,{Skin:{rimColor:'#00ff00'}},'Skin');
 expect(rows.map(row=>row.parameter)).toEqual(['baseColor','emissionColor','emissionStrength','shadeColor','rimColor','outlineColor','outlineWidth']);
 expect(rows.map(row=>[row.value,row.saved,row.readOnly])).toEqual([
  ['#ffe0d0',false,false],['#000000',false,false],[1,false,false],['#c09080',false,false],['#00ff00',true,false],['#202020',false,false],[0.01,false,false],
 ]);
 expect(materialRows(record,undefined,'Glass').map(row=>[row.parameter,row.value])).toEqual([['baseColor','#ffffff'],['opacity',0.4],['emissionColor','#000000'],['emissionStrength',1]]);
 expect(materialRows(record,undefined,'Hair')).toEqual([]);
});

it('shows the saved parameters of a missing material as read-only rows with a reset',()=>{
 const rows=materialRows(record,{Old:{opacity:0.5,baseColor:'#ff0000'}},'Old');
 expect(rows.map(row=>[row.parameter,row.value,row.saved,row.readOnly])).toEqual([['baseColor','#ff0000',true,true],['opacity',0.5,true,true]]);
 expect(materialRows(undefined,{Old:{baseColor:'#ff0000'}},'Old').map(row=>row.readOnly)).toEqual([true]);
});

it('keeps a saved parameter that no longer applies as a read-only row, so it can be removed',()=>{
 const rows=materialRows(record,{Skin:{opacity:0.5}},'Skin');
 expect(rows.find(row=>row.parameter==='opacity')).toMatchObject({value:0.5,saved:true,readOnly:true});
});

it('shows the section for a record with materials or for saved values only',()=>{
 expect(showsMaterials(record,undefined)).toBe(true);
 expect(showsMaterials([],{Old:{baseColor:'#ff0000'}})).toBe(true);
 expect(showsMaterials(undefined,undefined)).toBe(false);
 expect(showsMaterials([],{})).toBe(false);
});

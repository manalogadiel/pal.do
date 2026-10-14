import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const JSZip=createRequire(require.resolve('mammoth'))('jszip')
const paragraph=text=>`<w:p><w:r><w:t xml:space="preserve">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</w:t></w:r></w:p>`
export async function timetableDocx({imageOnly=false,large=false}={}) {
 const zip=new JSZip()
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
 zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 const rows=[['Subject','Days','Time','Room'],['BIO 101','MWF','9 AM – 10 AM','201'],['Math 2','TTh','1 PM – 2 PM','']]
 const body=imageOnly?'<w:p><w:r><w:pict><v:shape><v:imagedata r:id="image" o:title=""/></v:shape></w:pict></w:r></w:p>':large?paragraph('A'.repeat(100001)):paragraph('Weekly school schedule')+'<w:tbl>'+rows.map(row=>'<w:tr>'+row.map(cell=>'<w:tc>'+paragraph(cell)+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>'+paragraph('<script>alert(1)</script>')
 zip.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body>${body}<w:sectPr/></w:body></w:document>`)
 if(imageOnly){zip.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/></Relationships>');zip.file('word/media/image.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5b8AAAAASUVORK5CYII=','base64'))}
 return zip.generateAsync({type:'nodebuffer'})
}
export function timetablePdf(image=null,pageCount=4) {
 const objects=[]
 const put=body=>{objects.push(Buffer.isBuffer(body)?body:Buffer.from(body));return objects.length}
 put('<< /Type /Catalog /Pages 2 0 R >>');put('')
 const font=put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
 let imageId
 if(image)imageId=put(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1100 /Height 600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`),image,Buffer.from('\nendstream')]))
 const kids=[]
 for(let i=0;i<pageCount;i++){
  const content=image?'q 550 0 0 300 20 460 cm /Image1 Do Q':'BT /F1 18 Tf 30 730 Td (Weekly school schedule) Tj 0 -40 Td (BIO 101 | MWF | 9 AM - 10 AM | Room 201) Tj ET'
  const stream=put(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`)
  const page=put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 ${font} 0 R >> ${image?`/XObject << /Image1 ${imageId} 0 R >>`:''} >> /Contents ${stream} 0 R >>`)
  kids.push(`${page} 0 R`)
 }
 objects[1]=Buffer.from(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`)
 const buffers=[Buffer.from('%PDF-1.4\n')],offsets=[0];let length=buffers[0].length
 objects.forEach((body,i)=>{offsets.push(length);const part=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),body,Buffer.from('\nendobj\n')]);buffers.push(part);length+=part.length})
 buffers.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`))
 return Buffer.concat(buffers)
}

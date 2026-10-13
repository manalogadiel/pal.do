package com.paldo.app.ai;

import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;

public final class ModelStore {
    static final long MAX_BYTES=2L<<30, RESERVE=1L<<30;
    final File directory;
    public static final class Failure extends IOException {
        public final String code;
        Failure(String code) {super(code);this.code=code;}
    }
    public interface Validator {void validate(File file) throws Exception;}
    public interface Activation {void run() throws Exception;}
    public interface ActivationGate {void commit(Activation activation) throws Exception;}
    public static final class Model {
        public final File file; public final long bytes; public final String sha256;
        Model(File file,long bytes,String sha256){this.file=file;this.bytes=bytes;this.sha256=sha256;}
    }
    /** Every model kept on the phone (the bundled one and any imported), for the Settings picker */
    public List<Model> list(){
        List<Model> models=new ArrayList<>();
        File[] files=directory.listFiles((dir,name)->name.matches("[a-f0-9]{64}\\.gguf"));
        if(files!=null)for(File file:files)if(file.length()<=MAX_BYTES)models.add(new Model(file,file.length(),file.getName().substring(0,64)));
        models.sort(Comparator.comparing(m->m.sha256));
        return models;
    }
    public boolean has(String sha256){return sha256.matches("[a-f0-9]{64}") && new File(directory,sha256+".gguf").isFile();}
    /** Make a kept model the one that answers */
    public Model select(String sha256) throws IOException {
        if(!has(sha256)) throw new Failure("MISSING_MODEL");
        File file=new File(directory,sha256+".gguf");
        if(file.length()<24 || file.length()>MAX_BYTES) throw new Failure("INVALID_MODEL");
        File metadata=new File(directory,"selected.properties.partial");
        Properties properties=new Properties();properties.setProperty("sha256",sha256);properties.setProperty("bytes",Long.toString(file.length()));
        try(FileOutputStream output=new FileOutputStream(metadata)){properties.store(output,"Local model");output.getFD().sync();}
        Files.move(metadata.toPath(),new File(directory,"selected.properties").toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
        return new Model(file,file.length(),sha256);
    }
    /** Delete a kept model; the one answering can't be removed */
    public void remove(String sha256) throws IOException {
        Model selected=selected();
        if(selected!=null && selected.sha256.equals(sha256)) throw new Failure("BUSY");
        if(!has(sha256)) throw new Failure("MISSING_MODEL");
        new File(directory,sha256+".gguf").delete();
        Properties names=names();names.remove(sha256);storeNames(names);
    }
    /** Models earlier builds bundled, so they keep a real name after an update */
    static final String OLD_BUNDLE="74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db";
    public String name(String sha256){String fallback=OLD_BUNDLE.equals(sha256)?"Qwen2.5 0.5B Instruct":"Imported model";try{return names().getProperty(sha256,fallback);}catch(IOException e){return fallback;}}
    public void setName(String sha256,String name) throws IOException {Properties names=names();names.setProperty(sha256,name);storeNames(names);}
    private Properties names() throws IOException {
        Properties names=new Properties();File file=new File(directory,"models.properties");
        if(file.isFile())try(InputStream input=new FileInputStream(file)){names.load(input);}
        return names;
    }
    private void storeNames(Properties names) throws IOException {
        File partial=new File(directory,"models.properties.partial");
        try(FileOutputStream output=new FileOutputStream(partial)){names.store(output,"Model names");output.getFD().sync();}
        Files.move(partial.toPath(),new File(directory,"models.properties").toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
    }
    public ModelStore(File directory) throws IOException {
        this.directory=directory;
        if(!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create private model storage");
    }
    public Model selected() throws IOException {
        File pointer=new File(directory,"selected.properties");
        if(!pointer.isFile()) return null;
        Properties properties=new Properties();
        try(InputStream input=new FileInputStream(pointer)){properties.load(input);}
        String hash=properties.getProperty("sha256","");
        if(!hash.matches("[a-f0-9]{64}")) throw new Failure("INVALID_MODEL");
        long bytes;
        try {bytes=Long.parseLong(properties.getProperty("bytes","0"));} catch(NumberFormatException e){throw new Failure("INVALID_MODEL");}
        File file=new File(directory,hash+".gguf");
        if(bytes<24 || bytes>MAX_BYTES || !file.isFile() || file.length()!=bytes) throw new Failure("INVALID_MODEL");
        return new Model(file,bytes,hash);
    }
    public Model importStream(InputStream source,long expected,LongSupplier free,BooleanSupplier cancelled,Validator validator) throws Exception {
        return importStream(source,expected,free,cancelled,validator,activation->{if(cancelled.getAsBoolean())throw new Failure("CANCELLED");activation.run();});
    }
    public Model importStream(InputStream source,long expected,LongSupplier free,BooleanSupplier cancelled,Validator validator,ActivationGate gate) throws Exception {
        if(expected>MAX_BYTES || expected==0) throw new Failure("INVALID_MODEL");
        if(cancelled.getAsBoolean()) throw new Failure("CANCELLED");
        if(free.getAsLong()-Math.max(0,expected)<RESERVE) throw new Failure("INSUFFICIENT_SPACE");
        File temporary=File.createTempFile("import-",".partial",directory);
        File metadata=new File(directory,"selected.properties.partial");
        File activated=null;
        boolean committed=false,created=false;
        Model prior=selected();
        try {
            MessageDigest digest=MessageDigest.getInstance("SHA-256");long total=0;
            try(InputStream input=source;FileOutputStream output=new FileOutputStream(temporary)){
                byte[] buffer=new byte[128*1024];int count;
                while((count=input.read(buffer))!=-1){
                    if(cancelled.getAsBoolean()) throw new Failure("CANCELLED");
                    total+=count;
                    if(total>MAX_BYTES) throw new Failure("INVALID_MODEL");
                    if(free.getAsLong()-count<RESERVE) throw new Failure("INSUFFICIENT_SPACE");
                    output.write(buffer,0,count);digest.update(buffer,0,count);
                }
                output.getFD().sync();
            }
            if(total<24 || (expected>0 && expected!=total)) throw new Failure("INVALID_MODEL");
            try(RandomAccessFile input=new RandomAccessFile(temporary,"r")){
                if(input.readInt()!=0x47475546 || Integer.reverseBytes(input.readInt())!=3) throw new Failure("INVALID_MODEL");
                long tensors=Long.reverseBytes(input.readLong()), entries=Long.reverseBytes(input.readLong());
                if(tensors<0 || tensors>10000 || entries<0 || entries>10000) throw new Failure("INVALID_MODEL");
            }
            if(cancelled.getAsBoolean()) throw new Failure("CANCELLED");
            try {validator.validate(temporary);} catch(Failure e){throw e;} catch(Exception e){throw new Failure("INVALID_MODEL");}
            if(cancelled.getAsBoolean()) throw new Failure("CANCELLED");
            StringBuilder hex=new StringBuilder();for(byte value:digest.digest()) hex.append(String.format(Locale.ROOT,"%02x",value&255));
            String hash=hex.toString();activated=new File(directory,hash+".gguf");
            if(!activated.exists()){Files.move(temporary.toPath(),activated.toPath(),StandardCopyOption.ATOMIC_MOVE);created=true;}
            Properties properties=new Properties();properties.setProperty("sha256",hash);properties.setProperty("bytes",Long.toString(total));
            try(FileOutputStream output=new FileOutputStream(metadata)){properties.store(output,"Local model");output.getFD().sync();}
            gate.commit(()->Files.move(metadata.toPath(),new File(directory,"selected.properties").toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE));
            committed=true;
            return new Model(activated,total,hash);
        } finally {
            temporary.delete();metadata.delete();
            if(!committed && created && activated!=null) activated.delete();
        }
    }
}

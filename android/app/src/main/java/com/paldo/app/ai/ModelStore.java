package com.paldo.app.ai;

import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;

public final class ModelStore {
    static final long MAX_BYTES=1L<<30, RESERVE=1L<<30;
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
            if(prior!=null && !prior.sha256.equals(hash)) prior.file.delete();
            return new Model(activated,total,hash);
        } finally {
            temporary.delete();metadata.delete();
            if(!committed && created && activated!=null) activated.delete();
        }
    }
}

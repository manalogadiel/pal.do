package com.paldo.app.ai;

import java.io.*;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;

public final class BundledModel {
    public static final String ASSET="models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
    public static final long BYTES=491400032L;
    public static final String SHA256="74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db";
    public interface Source {InputStream open() throws IOException;}
    public interface Progress {void update(long copied,long total);}
    private final long bytes;
    private final String sha256;
    public BundledModel(long bytes,String sha256){this.bytes=bytes;this.sha256=sha256;}
    public ModelStore.Model ensure(ModelStore store,Source source,LongSupplier free,BooleanSupplier cancelled,ModelStore.Validator validator,ModelStore.ActivationGate gate,Progress progress)throws Exception{
        ModelStore.Model prior=store.selected();if(prior!=null)return prior;
        progress.update(0,bytes);
        try(InputStream input=new FilterInputStream(source.open()){
            private long copied=0,last=0;
            @Override public int read(byte[] buffer,int offset,int length)throws IOException{
                int count=in.read(buffer,offset,length);
                if(count>0){copied+=count;if(copied-last>=4*1024*1024 || copied>=bytes){last=copied;progress.update(copied,bytes);}}
                return count;
            }
        }){
            return store.importStream(input,bytes,free,cancelled,file->{
                MessageDigest digest=MessageDigest.getInstance("SHA-256");
                try(InputStream check=new FileInputStream(file)){byte[] buffer=new byte[128*1024];int count;while((count=check.read(buffer))!=-1){if(cancelled.getAsBoolean())throw new ModelStore.Failure("CANCELLED");digest.update(buffer,0,count);}}
                StringBuilder hash=new StringBuilder();for(byte value:digest.digest())hash.append(String.format(Locale.ROOT,"%02x",value&255));
                if(!sha256.equals(hash.toString()))throw new ModelStore.Failure("INVALID_MODEL");
                validator.validate(file);
            },gate);
        }
    }
}

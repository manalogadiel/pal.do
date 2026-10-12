package com.paldo.app.ai;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;

public final class NativeEngine {
    private static final boolean AVAILABLE;
    static {boolean loaded=false;if(cpuSupported()){try {System.loadLibrary("paldo-ai");loaded=true;}catch(UnsatisfiedLinkError ignored){}}AVAILABLE=loaded;}
    /**
     * The engine is built for ARMv8.2 dot-product and fp16 math (about twice as fast on the phone as generic code).
     * Older cores without them (Cortex-A53-only chips) would crash on the first instruction, so they never load it.
     */
    static boolean cpuSupported(){
        try(BufferedReader reader=new BufferedReader(new FileReader("/proc/cpuinfo"))){
            String line;boolean seen=false;
            while((line=reader.readLine())!=null){
                if(!line.startsWith("Features"))continue;
                seen=true;
                String features=" "+line.substring(line.indexOf(':')+1).trim()+" ";
                if(!features.contains(" asimddp ")||!features.contains(" asimdhp "))return false;
            }
            return seen;
        }catch(IOException error){return false;}
    }
    public static boolean available(){return AVAILABLE;}
    private static void check(){if(!AVAILABLE)throw new IllegalStateException("UNSUPPORTED_ARCH");}
    public void load(String path){check();nativeLoad(path);}
    public String generate(String requestId,String messagesJson,int maxTokens){check();return nativeGenerate(requestId,messagesJson,maxTokens);}
    public void cancel(String requestId){if(AVAILABLE)nativeCancel(requestId);}
    public void unload(){if(AVAILABLE)nativeUnload();}
    private static native void nativeLoad(String path);
    private static native String nativeGenerate(String requestId,String messagesJson,int maxTokens);
    private static native void nativeCancel(String requestId);
    private static native void nativeUnload();
}

#include <jni.h>
#include <llama.h>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <chrono>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

using json=nlohmann::json;
using Clock=std::chrono::steady_clock;
static std::mutex operationMutex, requestMutex;
static std::atomic<bool> cancelled{false};
static std::string activeRequest;
static std::string cancelledRequest;
static llama_model *model=nullptr;
static llama_context *context=nullptr;
static Clock::time_point deadline;
/** Tokens already in the KV cache from the last request: the fixed rules at the top of every prompt are read once */
static std::vector<llama_token> cached;
static long long milliseconds(Clock::time_point start){return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now()-start).count();}
static void raise(JNIEnv *env,const char *code){env->ThrowNew(env->FindClass("java/lang/IllegalStateException"),code);}
static std::string utf8(JNIEnv *env,jstring value){
    if(!value)throw std::runtime_error("INFERENCE_FAILED");
    jclass cls=env->FindClass("java/lang/String");
    jstring encoding=env->NewStringUTF("UTF-8");
    auto bytes=(jbyteArray)env->CallObjectMethod(value,env->GetMethodID(cls,"getBytes","(Ljava/lang/String;)[B"),encoding);
    if(env->ExceptionCheck() || !bytes)throw std::runtime_error("INFERENCE_FAILED");
    std::string result(env->GetArrayLength(bytes),'\0');
    env->GetByteArrayRegion(bytes,0,(jsize)result.size(),reinterpret_cast<jbyte *>(result.data()));
    env->DeleteLocalRef(bytes);env->DeleteLocalRef(encoding);env->DeleteLocalRef(cls);return result;
}
static jstring javaString(JNIEnv *env,const std::string &value){
    jbyteArray bytes=env->NewByteArray((jsize)value.size());
    env->SetByteArrayRegion(bytes,0,(jsize)value.size(),reinterpret_cast<const jbyte *>(value.data()));
    jclass cls=env->FindClass("java/lang/String");jstring encoding=env->NewStringUTF("UTF-8");
    auto result=(jstring)env->NewObject(cls,env->GetMethodID(cls,"<init>","([BLjava/lang/String;)V"),bytes,encoding);
    env->DeleteLocalRef(bytes);env->DeleteLocalRef(encoding);env->DeleteLocalRef(cls);return result;
}
static void release(){cached.clear();if(context){llama_free(context);context=nullptr;}if(model){llama_model_free(model);model=nullptr;}}
static bool abortDecode(void *){return cancelled.load() || Clock::now()>deadline;}
static void checkCancel(){if(cancelled.load())throw std::runtime_error("CANCELLED");if(Clock::now()>deadline)throw std::runtime_error("INFERENCE_FAILED");}
static std::vector<llama_token> tokenize(const std::string &text){
    const auto *vocab=llama_model_get_vocab(model);
    int count=llama_tokenize(vocab,text.data(),(int)text.size(),nullptr,0,true,true);
    if(count>=0 || count==INT32_MIN)throw std::runtime_error("INFERENCE_FAILED");
    std::vector<llama_token> tokens(-count);
    count=llama_tokenize(vocab,text.data(),(int)text.size(),tokens.data(),(int)tokens.size(),true,true);
    if(count<0)throw std::runtime_error("INFERENCE_FAILED");tokens.resize(count);return tokens;
}
static std::string format(const json &messages){
    std::vector<std::string> roles,contents;
    for(const auto &message:messages){
        std::string role=message.at("role").get<std::string>(),content=message.at("content").get<std::string>();
        if(role!="system" && role!="user" && role!="assistant")throw std::runtime_error("INFERENCE_FAILED");
        roles.push_back(role);contents.push_back(content);
    }
    std::vector<llama_chat_message> chat;
    for(size_t i=0;i<roles.size();i++)chat.push_back({roles[i].c_str(),contents[i].c_str()});
    const char *tmpl=llama_model_chat_template(model,nullptr);
    if(!tmpl)throw std::runtime_error("INVALID_MODEL");
    int size=llama_chat_apply_template(tmpl,chat.data(),chat.size(),true,nullptr,0);
    if(size<=0 || size>131072)throw std::runtime_error("PROMPT_TOO_LONG");
    std::string output(size,'\0');
    if(llama_chat_apply_template(tmpl,chat.data(),chat.size(),true,output.data(),size)!=size)throw std::runtime_error("INFERENCE_FAILED");
    return output;
}
static const char *grammar=R"gbnf(
root ::= "{" ws "\"text\"" ws ":" ws string "," ws "\"action\"" ws ":" ws object "}" ws
object ::= "{" ws (string ":" ws value ("," ws string ":" ws value)*)? "}" ws
array ::= "[" ws (value ("," ws value)*)? "]" ws
value ::= object | array | string | number | "true" ws | "false" ws | "null" ws
string ::= "\"" ([^"\\\x00-\x1f] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F]{4}))* "\"" ws
number ::= "-"? ("0" | [1-9] [0-9]*) ("." [0-9]+)? ([eE] [+-]? [0-9]+)? ws
ws ::= [ \t\n\r]{0,4}
)gbnf";

extern "C" JNIEXPORT void JNICALL Java_com_paldo_app_ai_NativeEngine_nativeLoad(JNIEnv *env,jclass,jstring path){
    std::lock_guard<std::mutex> lock(operationMutex);
    try {
        release();llama_backend_init();
        llama_log_set([](ggml_log_level,const char *,void *){},nullptr);
        auto params=llama_model_default_params();params.n_gpu_layers=0;params.load_mode=LLAMA_LOAD_MODE_MMAP;
        model=llama_model_load_from_file(utf8(env,path).c_str(),params);
        if(!model)throw std::runtime_error("LOAD_FAILED");
        if(llama_model_n_params(model)>1000000000ULL || !llama_model_chat_template(model,nullptr))throw std::runtime_error("INVALID_MODEL");
        auto cp=llama_context_default_params();cp.n_ctx=4096;cp.n_batch=128;cp.n_ubatch=128;cp.n_threads=2;cp.n_threads_batch=4;cp.abort_callback=abortDecode;
        context=llama_init_from_model(model,cp);
        if(!context)throw std::runtime_error("LOAD_FAILED");
    } catch(const std::exception &error){release();raise(env,error.what());}
}
extern "C" JNIEXPORT jstring JNICALL Java_com_paldo_app_ai_NativeEngine_nativeGenerate(JNIEnv *env,jclass,jstring request,jstring input,jint maxTokens){
    std::unique_lock<std::mutex> operation(operationMutex,std::try_to_lock);
    if(!operation.owns_lock()){raise(env,"BUSY");return nullptr;}
    try {
        if(!context || !model)throw std::runtime_error("MISSING_MODEL");
        const auto started=Clock::now();deadline=started+std::chrono::seconds(120);
        {std::lock_guard<std::mutex> lock(requestMutex);activeRequest=utf8(env,request);cancelled=cancelledRequest==activeRequest;cancelledRequest.clear();}
        checkCancel();
        std::string raw=utf8(env,input);
        if(raw.size()>65536)throw std::runtime_error("PROMPT_TOO_LONG");
        json messages=json::parse(raw);
        if(!messages.is_array() || messages.empty() || messages.size()>32)throw std::runtime_error("INFERENCE_FAILED");
        auto tokens=tokenize(format(messages));
        while(tokens.size()>3840){
            size_t index=messages.size();int priority=INT32_MAX;
            for(size_t i=0;i<messages.size();i++) if(!messages[i].value("required",true) && messages[i].value("priority",0)<priority){index=i;priority=messages[i].value("priority",0);}
            if(index==messages.size())throw std::runtime_error("PROMPT_TOO_LONG");
            messages.erase(index);tokens=tokenize(format(messages));checkCancel();
        }
        // Reuse the part of the last prompt that's identical (the fixed rules), and read only what changed.
        // Measured on a Galaxy A32: about half of each prompt, cutting the wait for the first word roughly in half.
        size_t reuse=0;
        while(reuse<cached.size() && reuse<tokens.size() && cached[reuse]==tokens[reuse])reuse++;
        if(reuse>=tokens.size())reuse=tokens.size()-1;
        if(reuse==0)llama_memory_clear(llama_get_memory(context),true);
        else llama_memory_seq_rm(llama_get_memory(context),0,(llama_pos)reuse,-1);
        cached.clear();
        for(size_t i=reuse;i<tokens.size();i+=128){
            checkCancel();auto batch=llama_batch_get_one(tokens.data()+i,(int)std::min<size_t>(128,tokens.size()-i));
            if(llama_decode(context,batch)!=0){checkCancel();throw std::runtime_error("INFERENCE_FAILED");}
        }
        cached=tokens;
        const auto *vocab=llama_model_get_vocab(model);
        std::unique_ptr<llama_sampler,decltype(&llama_sampler_free)> sampler(llama_sampler_chain_init(llama_sampler_chain_default_params()),llama_sampler_free);
        std::unique_ptr<llama_sampler,decltype(&llama_sampler_free)> constraint(llama_sampler_init_grammar(vocab,grammar,"root"),llama_sampler_free);
        if(!constraint)throw std::runtime_error("INFERENCE_FAILED");
        llama_sampler_chain_add(sampler.get(),llama_sampler_init_top_k(40));
        llama_sampler_chain_add(sampler.get(),llama_sampler_init_top_p(0.9f,1));
        llama_sampler_chain_add(sampler.get(),llama_sampler_init_temp(0.35f));
        llama_sampler_chain_add(sampler.get(),llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
        // Sample freely, then check only the picked token against the JSON grammar; the grammar runs over the
        // whole vocabulary only when that token would break the JSON. Running it over all ~150k tokens every step
        // was most of the time per word (4.6 → 13 words/s on a Galaxy A32).
        const int vocabSize=llama_vocab_n_tokens(vocab);
        std::vector<llama_token_data> candidates(vocabSize);
        auto pick=[&]()->llama_token{
            const float *logits=llama_get_logits_ith(context,-1);
            for(int k=0;k<vocabSize;k++)candidates[k]={k,logits[k],0.0f};
            llama_token_data_array all{candidates.data(),(size_t)vocabSize,-1,false};
            llama_sampler_apply(sampler.get(),&all);
            llama_token token=all.data[all.selected].id;
            llama_token_data one{token,1.0f,0.0f};
            llama_token_data_array single{&one,1,-1,false};
            llama_sampler_apply(constraint.get(),&single);
            if(single.data[0].logit==-INFINITY){
                for(int k=0;k<vocabSize;k++)candidates[k]={k,logits[k],0.0f};
                llama_token_data_array again{candidates.data(),(size_t)vocabSize,-1,false};
                llama_sampler_apply(constraint.get(),&again);
                llama_sampler_apply(sampler.get(),&again);
                token=again.data[again.selected].id;
            }
            llama_sampler_accept(constraint.get(),token);
            llama_sampler_accept(sampler.get(),token);
            return token;
        };
        std::string answer;long long firstTokenMs=0;int generated=0;
        const int limit=std::clamp((int)maxTokens,1,256);
        for(int i=0;i<limit;i++){
            checkCancel();llama_token token=pick();
            if(llama_vocab_is_eog(vocab,token))break;
            if(!generated)firstTokenMs=milliseconds(started);generated++;
            std::vector<char> piece(128);int size=llama_token_to_piece(vocab,token,piece.data(),(int)piece.size(),0,true);
            if(size<0){piece.resize(-size);size=llama_token_to_piece(vocab,token,piece.data(),(int)piece.size(),0,true);}
            if(size<0)throw std::runtime_error("INFERENCE_FAILED");answer.append(piece.data(),size);
            if(answer.size()>32768)throw std::runtime_error("INFERENCE_FAILED");
            auto batch=llama_batch_get_one(&token,1);
            if(llama_decode(context,batch)!=0){checkCancel();throw std::runtime_error("INFERENCE_FAILED");}
        }
        checkCancel();auto parsed=json::parse(answer);if(!parsed.is_object())throw std::runtime_error("INFERENCE_FAILED");
        json result={{"requestId",utf8(env,request)},{"text",answer},{"loadMs",0},{"firstTokenMs",firstTokenMs},{"generationMs",milliseconds(started)},{"promptTokens",tokens.size()},{"generatedTokens",generated}};
        {std::lock_guard<std::mutex> lock(requestMutex);activeRequest.clear();}
        return javaString(env,result.dump());
    } catch(const std::exception &error){
        // A cancelled or failed read can leave the cache half-filled: start clean next time
        cached.clear();if(context)llama_memory_clear(llama_get_memory(context),true);
        {std::lock_guard<std::mutex> lock(requestMutex);activeRequest.clear();}
        std::string code=error.what();
        if(code!="BUSY" && code!="MISSING_MODEL" && code!="CANCELLED" && code!="PROMPT_TOO_LONG")code="INFERENCE_FAILED";
        raise(env,code.c_str());return nullptr;
    }
}
extern "C" JNIEXPORT void JNICALL Java_com_paldo_app_ai_NativeEngine_nativeCancel(JNIEnv *env,jclass,jstring request){
    std::lock_guard<std::mutex> lock(requestMutex);
    try {std::string id=utf8(env,request);if(activeRequest==id)cancelled=true;else if(activeRequest.empty())cancelledRequest=id;}catch(const std::exception &error){raise(env,"INFERENCE_FAILED");}
}
extern "C" JNIEXPORT void JNICALL Java_com_paldo_app_ai_NativeEngine_nativeUnload(JNIEnv *,jclass){std::lock_guard<std::mutex> lock(operationMutex);release();}

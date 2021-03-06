(ns dirac.implant.eval
  (:require [cljs.core.async :refer [put! <! chan timeout alts! close! go go-loop]]
            [cljs.core.async.impl.protocols :as core-async]
            [oops.core :refer [oget oget+ ocall oapply gget]]
            [chromex.logging :refer-macros [log warn error]]
            [dirac.implant.feedback :as feedback]
            [clojure.string :as string]
            [dirac.utils :as utils]
            [cljs.tools.reader.edn :as edn]))

(def installation-help-url "https://github.com/binaryage/dirac/blob/master/docs/installation.md")

(defn ^:dynamic make-config-reading-error-message [e serialized-config]
  (str "Unable to read runtime config: " (.-message e) "\n"
       e "\n"
       "\n"
       "--- full config ---\n"
       serialized-config "\n\n"))

; -- configuration ----------------------------------------------------------------------------------------------------------

(defonce default-config
  {:install-check-total-time-limit               3000
   :install-check-next-trial-waiting-time        500
   :install-check-eval-time-limit                300
   :context-availability-total-time-limit        3000
   :context-availability-next-trial-waiting-time 10
   :eval-time-limit                              10000
   :update-banner-fn                             nil
   :display-user-info-fn                         nil
   :display-user-error-fn                        nil})

(defonce current-config (atom default-config))

(defn update-config! [config]
  (swap! current-config merge config))

(defn pref [name]
  (name @current-config))

; -- helpers ----------------------------------------------------------------------------------------------------------------

(defn get-dirac []
  {:post [(object? %)]}
  (if-let [dirac (gget "?dirac")]
    dirac
    (throw (ex-info (str "window.dirac not found") {}))))

(defn format-reason [e]
  (cond
    (string? e) e
    (vector? e) (pr-str e)
    :else (if-let [text (oget e "?text")]
            (str text)
            (if-let [stack (oget e "?stack")]
              (.toString stack)
              (.toString e)))))

(def supported-contexts #{:default :current})

(defn code-as-string [code]
  (if-let [eval-fn (oget (get-dirac) "?codeAsString")]
    (eval-fn code)
    (error "window.dirac.codeAsString not found")))

(defn subscribe-debugger-events! [f]
  (ocall (get-dirac) "subscribeDebuggerEvents" f))

(defn unsubscribe-debugger-events! [f]
  (ocall (get-dirac) "unsubscribeDebuggerEvents" f))

(defn get-has-context-fn-name [context]
  (case context
    :default "hasDefaultContext"
    :current "hasCurrentContext"))

(defn get-eval-in-context-fn-name [context]
  (case context
    :default "evalInDefaultContext"
    :current "evalInCurrentContext"))

(defn get-current-time []
  (.getTime (js/Date.)))

(defn check-and-call-when-avail-or-timeout [check-fn call-fn timeout-fn trial-delay total-time-limit]
  (let [start-time (get-current-time)]
    (go-loop []
      (let [current-time (get-current-time)
            elapsed-time (- current-time start-time)]
        (if (< elapsed-time total-time-limit)
          (if (check-fn)
            (call-fn)
            (do
              (<! (timeout trial-delay))
              (recur)))
          (timeout-fn))))))

(defn eval-with-callback!
  "Attempts to evaluate given code string in specified context.
  Optionally calls provided callback with evaluation result
    [::ok result],
    [::eval-exception exception-details] or
    [::context-timeout]
  Throws on internal error."
  [context code & [callback silent]]
  (let [dirac (get-dirac)
        silent? (or (nil? silent) (true? silent))                                                                             ; by default we execute silently
        has-context-fn-name (get-has-context-fn-name context)]
    (if-let [has-context-fn (oget+ dirac "?" has-context-fn-name)]
      (let [eval-fn-name (get-eval-in-context-fn-name context)]
        (if-let [eval-fn (oget+ dirac "?" eval-fn-name)]
          (let [callback-wrapper (fn [result-remote-object exception-details]
                                   (if callback
                                     (let [result (if (some? exception-details)
                                                    [::eval-exception exception-details]
                                                    [::ok (if result-remote-object (oget result-remote-object "value"))])]
                                       (callback result))))
                call-fn (fn [] (eval-fn code silent? callback-wrapper))
                timeout-fn (fn []
                             (error "Unable to resolve javascript context in time" context code)
                             (if callback
                               (callback [::context-timeout])))
                trial-delay (pref :context-availability-next-trial-waiting-time)
                time-limit (pref :context-availability-total-time-limit)]
            (check-and-call-when-avail-or-timeout has-context-fn call-fn timeout-fn trial-delay time-limit))
          (throw (ex-info (str "Function '" eval-fn-name "' not found in window.dirac object") dirac))))
      (throw (ex-info (str "Function '" has-context-fn-name "' not found in window.dirac object") dirac)))))

(defn update-banner! [msg]
  (if-let [banner-fn (pref :update-banner-fn)]
    (banner-fn msg)))

(defn display-user-info! [msg]
  (if-let [info-fn (pref :display-user-info-fn)]
    (info-fn msg)))

(defn display-user-error! [msg & more]
  (warn msg more)
  (if-let [error-fn (pref :display-user-error-fn)]
    (error-fn msg)))

; -- code templates ---------------------------------------------------------------------------------------------------------

(defn ^:dynamic installation-test-template []
  (str "(dirac.runtime.installed_QMARK_() && dirac.runtime.repl.bootstrapped_QMARK_())"))

(defn ^:dynamic output-template [job-id kind format text]
  (str "dirac.runtime.repl.present_output(" job-id ", '" kind "', '" format "', " (code-as-string text) ")"))

(defn ^:dynamic result-template [job-id value]
  (str "dirac.runtime.repl.present_repl_result(" job-id ", cljs.reader.read_string(" (code-as-string value) "))"))

(defn ^:dynamic console-log-template [method & args]
  (str "console." method "(" (string/join (interpose "," (map code-as-string args))) ")"))

; -- message templates ------------------------------------------------------------------------------------------------------

(defn ^:dynamic missing-runtime-msg [reason]
  (str "Dirac requires runtime support from page context.\n"
       (if (and (some? reason) (not= reason "Uncaught")) (str (format-reason reason) "\n"))
       "Please install Dirac Runtime into your app and enable the :repl feature: " installation-help-url "."))

(defn ^:dynamic runtime-exception-msg [reason]
  (str "Dirac runtime unexpectedly thrown an exception."
       (if (some? reason) (str "\n" (format-reason reason)))))

(defn ^:dynamic internal-eval-error-msg [code reason]
  (str "Dirac encountered internal eval error."
       (if (some? reason) (str "\n" (format-reason reason) "\n"))
       "While evaluating:\n"
       code))

(defn ^:dynamic eval-problem-msg [code key reason]
  (str "Dirac encountered an internal eval problem (" key ")."
       (if (some? reason) (str "\n" (format-reason reason) "\n"))
       "While evaluating:\n"
       code))

(defn ^:dynamic eval-timeout-msg [code]
  (str "Dirac encountered internal eval timeout while evaluating:\n"
       code))

; -- resumable timer --------------------------------------------------------------------------------------------------------

(defprotocol IResumable
  (-pause [o])
  (-resume [o]))

(deftype ResumableTimer [callback ^:mutable remaining-time ^:mutable start-time ^:mutable timer-id]
  IResumable
  (-pause [this]
    (assert timer-id)
    (assert start-time)
    (js/clearTimeout timer-id)
    (set! timer-id nil)
    (set! remaining-time (- remaining-time (- (get-current-time) start-time)))
    (set! start-time nil))
  (-resume [this]
    (assert remaining-time)
    (assert callback)
    (set! start-time (get-current-time))
    (set! timer-id (js/setTimeout callback remaining-time))))

(defn make-resumable-timer [callback delay]
  (let [resumable-timer (ResumableTimer. callback delay nil nil)]
    (-resume resumable-timer)
    resumable-timer))

; -- debugger-aware timeout -------------------------------------------------------------------------------------------------

(defonce ^:dynamic *subscribed-to-debugger-events* false)
(defonce ^:dynamic *managed-resumable-timers* #{})

(defn pause-managed-timers []
  (doseq [resumable-timer *managed-resumable-timers*]
    (-pause resumable-timer)))

(defn resume-managed-timers []
  (doseq [resumable-timer *managed-resumable-timers*]
    (-resume resumable-timer)))

(defn handle-debugger-event [kind & args]
  (case kind
    "DebuggerPaused" (pause-managed-timers)
    "DebuggerResumed" (resume-managed-timers)
    true))

(defn subscribe-to-debugger-events-if-needed! []
  (when-not *subscribed-to-debugger-events*
    (subscribe-debugger-events! handle-debugger-event)
    (set! *subscribed-to-debugger-events* true)))

(defn start-managing-timer-on-debugger-pauses! [resumable-timer]
  (subscribe-to-debugger-events-if-needed!)
  (set! *managed-resumable-timers* (conj *managed-resumable-timers* resumable-timer)))

(defn stop-managing-timer-on-debugger-pauses! [resumable-timer]
  (set! *managed-resumable-timers* (disj *managed-resumable-timers* resumable-timer)))

(defn make-debugger-aware-timeout! [msec]
  (let [wait-chan (chan)
        resumable-timer (make-resumable-timer #(close! wait-chan) msec)]
    (go
      (start-managing-timer-on-debugger-pauses! resumable-timer)
      (<! wait-chan)
      (stop-managing-timer-on-debugger-pauses! resumable-timer)
      true)))

; -- convenient eval wrapper ------------------------------------------------------------------------------------------------

(defn call-eval-with-timeout!
  "Attempts to evaluate given code string in specified context within specified time limit.
   This function should never throw, returns:
     [::internal-error ex] in case of internal problem
     [::context-timeout] in case of eval context availability timeout
     [::eval-timeout] in case of eval timeout
     [::eval-exception exception-details] in case of eval exception
     [::ok value] in case of proper execution
     "
  [context code time-limit silent?]
  {:pre [(context supported-contexts)]}
  (let [result-chan (chan)
        timeout-chan (make-debugger-aware-timeout! time-limit)
        callback (fn [result]
                   (put! result-chan result))]
    (go
      (try
        (eval-with-callback! context code callback silent?)
        (catch :default e
          (put! result-chan [::internal-error e])))
      (let [[result ch] (alts! [result-chan timeout-chan])]                                                                   ; when timeout channel closes, the result is nil
        (if (= ch timeout-chan)
          (do
            (close! result-chan)
            [::eval-timeout])
          result)))))

; returns with
; either [::ok value]
; or     [::failure reason]
(defn wait-for-dirac-installed! []
  (let [timeout-chan (timeout (pref :install-check-total-time-limit))
        trial-delay (pref :install-check-next-trial-waiting-time)
        installation-test-eval-time-limit (pref :install-check-eval-time-limit)
        installation-test-code (installation-test-template)
        last-reason (volatile! [::install-check-timeout])
        return (fn [& [val]] (or val [::failure @last-reason]))]
    (go-loop []
      (if (core-async/closed? timeout-chan)
        (return)
        (let [result-chan (call-eval-with-timeout! :default installation-test-code installation-test-eval-time-limit true)
              [result] (alts! [result-chan timeout-chan])]
          (case (first result)
            ::ok (return result)
            (do
              (if-let [reason (second result)]
                (vreset! last-reason reason))
              (<! (timeout trial-delay))                                                                                      ; don't DoS the VM, wait between installation tests
              (recur))))))))

; -- simple evaluation for page-context console logging ---------------------------------------------------------------------

(defn console-info! [& args]
  (eval-with-callback! :default (apply console-log-template "info" args)))

(defn console-error! [& args]
  (eval-with-callback! :default (apply console-log-template "error" args)))

(defn console-warn! [& args]
  (eval-with-callback! :default (apply console-log-template "warn" args)))

(defn console-log! [& args]
  (eval-with-callback! :default (apply console-log-template "log" args)))

; -- serialization of evaluations -------------------------------------------------------------------------------------------

; We want to serialize all eval requests. In other words: we don't want to have two or more evaluations "in-flight".
;
; Without serialization the results could be unpredictably out of order, for example imagine we get two network requests:
; 1. print output "some warning"
; 2. eval "some code"
; And we call js/dirac.evalInCurrentContext to process both of them in quick order.
; Without serialization, the code evaluation result could appear in the console above the warning
; because of async nature of dirac.evalInCurrentContext and async nature of console API (chrome debugger protocol).
;
; Also look into implementation of process-message :eval-js, there is a deliberate delay before processing eval-js requests
; This means printing messages in tunnel have better chance to complete before a subsequent eval is executed.

(defonce eval-requests (chan))

(defn start-eval-request-queue-processing-loop! []
  (go-loop []
    (if-let [[context code silent? handler] (<! eval-requests)]
      (let [call-handler! (fn [result-code value error]
                            (if (some? error)
                              (display-user-error! error))
                            (if handler
                              (apply handler [value error])))
            install-result (<! (wait-for-dirac-installed!))
            eval-time-limit (pref :eval-time-limit)]
        (case (first install-result)
          ::failure (let [reason (second install-result)]
                      (call-handler! ::install-failure reason (missing-runtime-msg reason)))
          ::ok (let [eval-result (<! (call-eval-with-timeout! context code eval-time-limit silent?))]
                 (case (first eval-result)
                   ::ok (call-handler! ::ok (second eval-result))
                   ::internal-error (call-handler! ::internal-error
                                                   (second eval-result)
                                                   (internal-eval-error-msg code (second eval-result)))
                   ::eval-timeout (call-handler! ::eval-timeout
                                                 (second eval-result)
                                                 (eval-timeout-msg code))
                   (call-handler! ::unknown-problem
                                  (second eval-result)
                                  (eval-problem-msg code (first eval-result) (second eval-result))))))
        (recur))
      (log "Leaving start-eval-request-queue-processing-loop!"))))

; -- queued evaluation in context -------------------------------------------------------------------------------------------

(defn queue-eval-request! [context code silent? handler]
  (put! eval-requests [context code silent? handler]))

(defn eval-in-context! [context code silent?]
  (let [result-chan (chan)
        handler (fn [& args]
                  (put! result-chan args))]
    (queue-eval-request! context code silent? handler)
    result-chan))

(defn safely-eval-in-context! [context safe-value code & [silent?]]
  {:pre [(context supported-contexts)
         (string? code)]}
  (go
    (let [[value error] (<! (eval-in-context! context code silent?))]
      (if (nil? error)
        value
        safe-value))))

; -- probing of page context ------------------------------------------------------------------------------------------------

(defn is-runtime-present? []
  (go
    (let [[value error] (<! (eval-in-context! :default "dirac.runtime" true))]
      (if (nil? error)
        true
        (format-reason value)))))

(defn get-runtime-version []
  (safely-eval-in-context! :default "0.0.0" "dirac.runtime.get_version()"))

(defn is-runtime-repl-enabled? []
  (safely-eval-in-context! :default false "dirac.runtime.repl.installed_QMARK_()"))

(defn get-runtime-repl-api-version []
  (go
    (let [value (<! (safely-eval-in-context! :default "0" "dirac.runtime.repl.get_api_version()"))]
      (utils/parse-int value))))

(defn get-runtime-config []
  (go
    (let [serialized-config (<! (safely-eval-in-context! :default "{}" "dirac.runtime.repl.get_serialized_config()"))]
      (try
        (edn/read-string serialized-config)
        (catch :default e
          (throw (ex-info (make-config-reading-error-message e serialized-config) {})))))))

(defn get-runtime-tag []
  (go
    (let [value (<! (safely-eval-in-context! :default "?" "dirac.runtime.get_tag()"))]
      (str value))))

; -- printing captured server-side output -----------------------------------------------------------------------------------

(defn present-server-side-output! [job-id kind format text]
  (feedback/post! (str "present-server-side-output! " kind "/" format " > " text))
  (let [code (output-template (utils/parse-int job-id) kind format text)]
    (safely-eval-in-context! :default nil code)))

(defn present-server-side-result! [job-id value]
  (feedback/post! (str "present-server-side-result! " value))
  (let [code (result-template (utils/parse-int job-id) value)]
    (safely-eval-in-context! :default nil code)))

; -- fancy evaluation in currently selected context -------------------------------------------------------------------------

(defn eval-in-current-context! [code]
  ; this should be called from weasel for all compiled clojurescript snippets coming via REPL
  ; we want to eval it with silent=false so that "Pause on caught exceptions works" with commands entered into Dirac prompt
  ; see https://github.com/binaryage/dirac/issues/70
  (eval-in-context! :current code false))

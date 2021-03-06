(ns dirac.travis
  (:require [cuerdas.core :as cuerdas])
  (:import (java.util.concurrent ThreadLocalRandom)))

(def ANSI_CLEAR "\033[0K")
(def CLEAR_LINE (str "\r" ANSI_CLEAR))

(defn current-nano-time []
  (System/nanoTime))

(defn gen-random-long []
  (Math/abs (.nextLong (ThreadLocalRandom/current))))

(defn gen-random-timer-id []
  (str "dirac-travis-timer-" (gen-random-long)))

(defn get-folding-name [name]
  (cuerdas/kebab name))

(defn print-and-flush [& args]
  (apply print args)
  (flush))

; -- raw commands -----------------------------------------------------------------------------------------------------------

(defn travis-fold-command [action name]
  (str "travis_fold:" action
       ":" name
       CLEAR_LINE))

(defn travis-start-time-command [timer-id]
  (str "travis_time:"
       "start:" timer-id
       CLEAR_LINE))

(defn travis-end-time-command [timer-id start-time end-time]
  (let [duration (- end-time start-time)]
    (str "travis_time:"
         "end:" timer-id ":"
         "start=" start-time ",finish=" end-time ",duration=" duration
         CLEAR_LINE)))

; -- wrappers ---------------------------------------------------------------------------------------------------------------

(defn wrap-with-timing [forms]
  `(let [timer-id# (gen-random-timer-id)
         start-time# (current-nano-time)]
     (print-and-flush (travis-start-time-command timer-id#))
     (try
       ~@forms
       (finally
         (let [end-time# (current-nano-time)]
           (print-and-flush (travis-end-time-command timer-id# start-time# end-time#)))))))

(defn wrap-with-folding [name forms]
  `(let [name# ~name]
     (print-and-flush (travis-fold-command "start" name#))
     (try
       ~@forms
       (finally
         (print-and-flush (travis-fold-command "end" name#))))))

; -- public api -------------------------------------------------------------------------------------------------------------

(defmacro with-travis-fold [title name & body]
  (let [forms (cons `(println ~title) body)
        folding-name `(get-folding-name ~name)]
    (wrap-with-folding folding-name (list (wrap-with-timing forms)))))

# 🎯 Quiz: Sentiment Analysis with Logistic Regression

Test your understanding of sentiment analysis using logistic regression on text data (like movie reviews).

---

## ✅ Multiple Choice Questions

**1. What is the main goal of this sentiment analysis project?**  
A. To count words in each review  
B. To classify reviews as either positive or negative  
C. To detect the language of the review  
D. To translate reviews into English  

---

**2. What does the following code do?**  
```python
cv.fit_transform(data['text']).toarray()
```  
A. Converts reviews to lowercase  
B. Splits data into training and testing  
C. Converts text reviews into numerical feature arrays  
D. Removes special characters from text  

---

**3. Why do we use this line?**  
```python
data['sentiment'] = data['sentiment'].replace(['pos', 'neg'], [1, 0])
```  
A. To clean the reviews  
B. To label positive reviews as 0  
C. To convert text labels into numeric values  
D. To count the total reviews  

---

**4. What is the purpose of `train_test_split()`?**  
A. To shuffle the rows  
B. To convert reviews to vectors  
C. To divide the dataset into training and testing sets  
D. To remove null values  

---

**5. What does `model.fit(reviews_train, sent_train)` do?**  
A. Tests the model  
B. Trains the model on labeled review data  
C. Visualizes the confusion matrix  
D. Cleans the review data  

---

## 🔁 True or False

**6. The labels "pos" and "neg" must be converted to numbers before model training.**  
✅ True  
❌ False

---

**7. `predict = model.predict(reviews_test)` is used during training.**  
✅ True  
❌ False

---

**8. Logistic Regression is only used for numerical regression problems.**  
✅ True  
❌ False

---

## 📊 Bonus: Confusion Matrix

Look at the confusion matrix below (example):

```
[[87 13]
 [ 9 91]]
```

**9. How many positive reviews were correctly classified?**  
A. 87  
B. 91  
C. 13  
D. 9

**10. How many reviews were misclassified in total?**  
A. 22  
B. 13  
C. 9  
D. 100

---

## ✅ Answer Key

1. B  
2. C  
3. C  
4. C  
5. B  
6. ✅ True  
7. ❌ False  
8. ❌ False  
9. B (91 positive predicted correctly)  
10. A (13 + 9 = 22 misclassified)

---

💡 *Tip:* Use this quiz to revise after building your sentiment analysis project. Add your own questions as you learn more!

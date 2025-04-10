import SwiftUI

struct ContentView: View {
    @State private var promptText = "" // Text in the text box
    @State private var submittedText = "" // Text in the user bubble (fixed after submission)
    @State private var isGenerating = false
    @State private var hasSubmitted = false
    @State private var conversation: [Message] = [] // Store conversation history
    @State private var aiResponseText = "" // Store AI response text as it animates
    @State private var scrollToBottom = false // Track when we need to scroll
    
    // ID for the bottom anchor view to scroll to
    private let bottomID = "bottomAnchor"
    
    @FocusState private var isPromptFocused: Bool
    
    let spotifyGreen = Color(red: 29/255, green: 185/255, blue: 84/255)
    let darkBackground = Color(red: 18/255, green: 18/255, blue: 18/255)
    let darkGray = Color(red: 40/255, green: 40/255, blue: 40/255)
    
    let examplePrompts = [
        "Create me a playlist with happy vibes",
        "Make a workout mix with high energy",
        "Generate a chill evening playlist",
        "Suggest songs for a road trip"
    ]
    
    // Custom Message struct
    struct Message: Identifiable, Equatable { 
        let id = UUID()
        let userMessage: String
        let aiResponse: String
        
        static func == (lhs: Message, rhs: Message) -> Bool {
            return lhs.userMessage == rhs.userMessage && lhs.aiResponse == rhs.aiResponse
        }
    }

    var body: some View {
        ZStack {
            darkBackground.edgesIgnoringSafeArea(.all)
            
            VStack(spacing: 0) {
                // App logo and title
                VStack(spacing: 5) {
                    if !hasSubmitted {
                        Image(systemName: "waveform")
                            .font(.system(size: 60))
                            .foregroundColor(spotifyGreen)
                        
                        Text("Vibetify")
                            .font(.system(size: 36, weight: .bold, design: .rounded))
                            .foregroundColor(.white)
                        
                        Text("AI-Powered Music Experience")
                            .font(.subheadline)
                            .foregroundColor(.gray)
                    }
                }
                .padding(.top, 60)
                
                // ScrollView to show the conversation (chat history)
                ScrollViewReader { scrollViewProxy in
                    ScrollView {
                        VStack(spacing: 10) {
                            ForEach(conversation) { message in
                                // User message bubble
                                HStack {
                                    Spacer()
                                    Text(message.userMessage)
                                        .padding()
                                        .background(darkGray)
                                        .foregroundColor(.white)
                                        .cornerRadius(16)
                                        .frame(maxWidth: 250, alignment: .trailing)
                                        .transition(.move(edge: .trailing).combined(with: .opacity))
                                }
                                .padding(.horizontal)
                                
                                // AI response bubble
                                HStack(alignment: .top) {
                                    Circle()
                                        .fill(spotifyGreen)
                                        .frame(width: 12, height: 12)
                                        .padding(.top, 8)

                                    Text(message.aiResponse)
                                        .padding()
                                        .background(darkGray)
                                        .foregroundColor(.white)
                                        .cornerRadius(16)
                                        .frame(maxWidth: 250, alignment: .leading)
                                        .transition(.opacity.combined(with: .scale))
                                }
                                .padding(.horizontal)
                            }
                            
                            // Invisible spacer view that acts as our scroll target
                            // This ensures we have space between the last message and the input box
                            Color.clear
                                .frame(height: 60) // Space between last message and input
                                .id(bottomID)
                        }
                        .padding(.top, 20)
                        .onChange(of: conversation) { _ in
                            scrollToBottom = true
                        }
                        .onChange(of: aiResponseText) { _ in
                            // Also scroll when AI is typing
                            scrollToBottom = true
                        }
                        .onAppear {
                            // Initial scroll if needed
                            if !conversation.isEmpty {
                                scrollToBottom = true
                            }
                        }
                        .onChange(of: scrollToBottom) { needsScroll in
                            if needsScroll {
                                // Scroll with animation for smooth experience
                                withAnimation(.easeOut(duration: 0.4)) {
                                    scrollViewProxy.scrollTo(bottomID, anchor: .bottom)
                                }
                                // Reset the flag after scrolling
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                                    scrollToBottom = false
                                }
                            }
                        }
                    }
                }
                
                Spacer()

                VStack(spacing: 20) {
                    // Example prompts ABOVE the input
                    VStack(alignment: .leading, spacing: 10) {
                            
                        if !hasSubmitted {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 10) {
                                    ForEach(examplePrompts, id: \.self) { prompt in
                                        Button(action: {
                                            promptText = prompt
                                            isPromptFocused = true // focus keyboard
                                        }) {
                                            Text(prompt)
                                                .font(.caption)
                                                .padding(.horizontal, 12)
                                                .padding(.vertical, 8)
                                                .background(darkGray)
                                                .foregroundColor(.white)
                                                .cornerRadius(16)
                                        }
                                    }
                                }
                            }
                            .transition(.opacity.combined(with: .move(edge: .top)))
                            .animation(.easeInOut(duration: 0.4), value: hasSubmitted)
                        }
                    }
                    
                    // Prompt input + button
                    ZStack(alignment: .trailing) {
                        TextField("Ask Vibetify...", text: $promptText)
                            .padding(.horizontal, 16)
                            .padding(.trailing, 40) // Leave space for the button
                            .padding(.vertical, 12)
                            .background(darkGray)
                            .cornerRadius(12)
                            .foregroundColor(.white)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(spotifyGreen, lineWidth: 1)
                            )
                            .keyboardType(.default)
                            .submitLabel(.done)
                            .focused($isPromptFocused)
                            .onTapGesture {
                                isPromptFocused = true
                                // Also scroll to bottom when tapping the text field
                                scrollToBottom = true
                            }
                            .onSubmit {
                                isPromptFocused = false
                            }
                        
                        if !promptText.isEmpty {
                            Button(action: {
                                withAnimation {
                                    isGenerating = true
                                    isPromptFocused = false
                                    hasSubmitted = true
                                }

                                // Add user message to the conversation history
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                                    let userMessage = promptText
                                    conversation.append(Message(userMessage: userMessage, aiResponse: ""))
                                    promptText = "" // Reset the input field
                                }

                                // Simulate AI thinking time
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                                    // After delay, start animating the AI response text
                                    let aiResponse = "Generating a vibey playlist for you... 🎶"
                                    animateAIResponse(aiResponse)
                                }
                            }) {
                                Image(systemName: "arrow.right.circle.fill")
                                    .font(.system(size: 22))
                                    .foregroundColor(spotifyGreen)
                            }
                            .padding(.trailing, 12)
                        }
                    }
                    .frame(height: 50)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
                    .animation(.easeInOut(duration: 0.4), value: hasSubmitted)
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                
                Spacer()
                
                // Audio wave animation
                if !hasSubmitted {
                    HStack(alignment: .center, spacing: 4) {
                        ForEach(0..<7) { i in
                            RoundedRectangle(cornerRadius: 2)
                                .fill(spotifyGreen)
                                .frame(width: 4, height: 15 + CGFloat(i % 3) * 15)
                                .opacity(isGenerating ? 1 : 0.3)
                                .animation(
                                    Animation.easeInOut(duration: 0.6)
                                        .repeatForever()
                                        .delay(Double(i) * 0.1),
                                    value: isGenerating
                                )
                        }
                    }
                    .padding(.bottom, 100)
                }
            }
            .padding()
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                isPromptFocused = true
            }
        }
        // Listen for keyboard appearance to trigger scrolling
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            scrollToBottom = true
        }
    }
    
    // Animate AI response letter by letter
    func animateAIResponse(_ aiResponse: String) {
        aiResponseText = "" // Clear any previous response
        var currentIndex = 0
        let maxIndex = aiResponse.count
        
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { timer in
            if currentIndex < maxIndex {
                aiResponseText.append(aiResponse[aiResponse.index(aiResponse.startIndex, offsetBy: currentIndex)])
                currentIndex += 1
                
                // Update the conversation with the current partial response
                if let lastUserMessage = conversation.last?.userMessage {
                    conversation[conversation.count - 1] = Message(userMessage: lastUserMessage, aiResponse: aiResponseText)
                }
            } else {
                timer.invalidate()
                // Final update with complete response
                if let lastUserMessage = conversation.last?.userMessage {
                    conversation[conversation.count - 1] = Message(userMessage: lastUserMessage, aiResponse: aiResponseText)
                }
            }
        }
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
            .preferredColorScheme(.dark)
    }
}


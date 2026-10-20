using Microsoft.AspNetCore.Identity;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Auth;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;

namespace Vistoria.Api.Services.Impl;

public class AuthService(
    IUserRepository users,
    IPasswordHasher<User> passwordHasher,
    AccessTokenGenerator tokens,
    TimeProvider time) : IAuthService
{
    private const string EmailField = "email";
    private const string EmailTaken = "E-mail já cadastrado.";

    public async Task<AuthDto> SignUpAsync(SignUpDto request, CancellationToken cancellationToken)
    {
        var email = User.NormalizeEmail(request.Email);
        if (await users.EmailExistsAsync(email, cancellationToken))
        {
            throw new ValidationException(EmailField, EmailTaken);
        }

        var now = time.GetUtcNow();
        var user = new User
        {
            Id = Guid.CreateVersion7(now),
            Name = request.Name.Trim(),
            Email = email,
            CreatedAt = now,
        };
        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);

        try
        {
            await users.AddAsync(user, cancellationToken);
        }
        catch (DuplicateEmailException)
        {
            // Dois cadastros com o mesmo e-mail passaram juntos pela checagem; o índice único decidiu.
            throw new ValidationException(EmailField, EmailTaken);
        }

        var token = tokens.Create(user);
        return new AuthDto(token.Token, token.ExpiresAt, new AuthUserDto(user.Id, user.Name));
    }
}
